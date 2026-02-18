<script lang="ts">
	import { page } from '$app/state';
	import {
		getDevice,
		listDeviceSessions,
		listSessionSteps,
		getDeviceStats,
		submitGoal as submitGoalCmd,
		stopGoal as stopGoalCmd
	} from '$lib/api/devices.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { track } from '$lib/analytics/track';
	import {
		DEVICE_TAB_CHANGE,
		DEVICE_GOAL_SUBMIT,
		DEVICE_GOAL_STOP,
		DEVICE_GOAL_COMPLETE,
		DEVICE_SESSION_EXPAND
	} from '$lib/analytics/events';

	const deviceId = page.params.deviceId!;

	// Tabs
	let activeTab = $state<'overview' | 'sessions' | 'run'>('overview');

	const tabs = [
		{ id: 'overview' as const, label: 'Overview', icon: 'ph:info-duotone' },
		{ id: 'sessions' as const, label: 'Sessions', icon: 'ph:clock-counter-clockwise-duotone' },
		{ id: 'run' as const, label: 'Run', icon: 'ph:play-duotone' }
	];

	// Device data from DB
	const deviceData = (await getDevice(deviceId)) as {
		deviceId: string;
		name: string;
		status: string;
		model: string | null;
		manufacturer: string | null;
		androidVersion: string | null;
		screenWidth: number | null;
		screenHeight: number | null;
		batteryLevel: number | null;
		isCharging: boolean;
		lastSeen: string;
		installedApps: Array<{ packageName: string; label: string }>;
	} | null;

	// Device stats
	const stats = (await getDeviceStats(deviceId)) as {
		totalSessions: number;
		successRate: number;
		avgSteps: number;
	} | null;

	// Session history
	interface Session {
		id: string;
		goal: string;
		status: string;
		stepsUsed: number | null;
		startedAt: Date;
		completedAt: Date | null;
	}
	interface Step {
		id: string;
		stepNumber: number;
		action: unknown;
		reasoning: string | null;
		result: string | null;
	}
	const initialSessions = await listDeviceSessions(deviceId);
	let sessions = $state<Session[]>(initialSessions as Session[]);
	let expandedSession = $state<string | null>(null);
	let sessionSteps = $state<Map<string, Step[]>>(new Map());

	// Run tab state
	let goal = $state('');
	let runStatus = $state<'idle' | 'running' | 'completed' | 'failed'>('idle');
	let currentGoal = $state('');
	let steps = $state<Array<{ step: number; action: string; reasoning: string }>>([]);

	// Real-time battery from WS
	let liveBattery = $state<number | null>(null);
	let liveCharging = $state(false);

	async function toggleSession(sessionId: string) {
		if (expandedSession === sessionId) {
			expandedSession = null;
			return;
		}
		expandedSession = sessionId;
		track(DEVICE_SESSION_EXPAND);
		if (!sessionSteps.has(sessionId)) {
			const loadedSteps = await listSessionSteps({ deviceId, sessionId });
			sessionSteps.set(sessionId, loadedSteps as Step[]);
			sessionSteps = new Map(sessionSteps);
		}
	}

	let runError = $state('');

	async function submitGoal() {
		if (!goal.trim()) return;
		runStatus = 'running';
		runError = '';
		currentGoal = goal;
		steps = [];
		track(DEVICE_GOAL_SUBMIT);

		try {
			await submitGoalCmd({ deviceId, goal });
		} catch (e: any) {
			runError = e.message ?? String(e);
			runStatus = 'failed';
		}
	}

	async function stopGoal() {
		try {
			await stopGoalCmd({ deviceId });
			runStatus = 'failed';
			runError = 'Stopped by user';
			track(DEVICE_GOAL_STOP);
		} catch {
			// ignore
		}
	}

	onMount(() => {
		const unsub = dashboardWs.subscribe((msg) => {
			switch (msg.type) {
				case 'device_status': {
					if (msg.deviceId === deviceId) {
						liveBattery = msg.batteryLevel as number;
						liveCharging = msg.isCharging as boolean;
					}
					break;
				}
				case 'goal_started': {
					if (msg.deviceId === deviceId) {
						runStatus = 'running';
						currentGoal = msg.goal as string;
						steps = [];
						activeTab = 'run';
					}
					break;
				}
				case 'step': {
					const action = msg.action as Record<string, unknown>;
					const actionStr = action?.action
						? `${action.action}${action.coordinates ? `(${(action.coordinates as number[]).join(',')})` : ''}`
						: JSON.stringify(action);
					steps = [
						...steps,
						{
							step: msg.step as number,
							action: actionStr,
							reasoning: (msg.reasoning as string) ?? ''
						}
					];
					break;
				}
				case 'goal_completed': {
					const success = msg.success as boolean;
					runStatus = success ? 'completed' : 'failed';
					track(DEVICE_GOAL_COMPLETE, { success });
					listDeviceSessions(deviceId).then((s) => {
						sessions = s as Session[];
					});
					break;
				}
			}
		});
		return unsub;
	});

	function formatTime(d: string | Date) {
		return (d instanceof Date ? d : new Date(d)).toLocaleString();
	}

	function relativeTime(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	let appSearch = $state('');
	const filteredApps = $derived(
		(deviceData?.installedApps ?? []).filter(
			(a) =>
				!appSearch ||
				a.label.toLowerCase().includes(appSearch.toLowerCase()) ||
				a.packageName.toLowerCase().includes(appSearch.toLowerCase())
		)
	);

	const battery = $derived(liveBattery ?? (deviceData?.batteryLevel as number | null));
	const charging = $derived(liveCharging || (deviceData?.isCharging as boolean));
</script>

<!-- Header -->
<div class="mb-6 flex items-center gap-3">
	<a
		href="/dashboard/devices"
		class="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
	>
		<Icon icon="ph:arrow-left-duotone" class="h-5 w-5" />
	</a>
	<div>
		<h2 class="text-2xl font-bold">{deviceData?.model ?? deviceId.slice(0, 8)}</h2>
		{#if deviceData?.manufacturer}
			<p class="text-sm text-neutral-500">{deviceData.manufacturer}</p>
		{/if}
	</div>
	<span
		class="ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
			{deviceData?.status === 'online'
			? 'bg-green-50 text-green-700'
			: 'bg-neutral-100 text-neutral-500'}"
	>
		<span
			class="inline-block h-1.5 w-1.5 rounded-full {deviceData?.status === 'online'
				? 'bg-green-500'
				: 'bg-neutral-300'}"
		></span>
		{deviceData?.status === 'online' ? 'Online' : 'Offline'}
	</span>
</div>

<!-- Tabs -->
<div class="mb-6 flex gap-1 rounded-xl bg-neutral-100 p-1">
	{#each tabs as tab}
		<button
			onclick={() => {
				activeTab = tab.id;
				track(DEVICE_TAB_CHANGE, { tab: tab.id });
			}}
			class="flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors
				{activeTab === tab.id
				? 'bg-white text-neutral-900 shadow-sm'
				: 'text-neutral-500 hover:text-neutral-700'}"
		>
			<Icon
				icon={tab.icon}
				class="h-4 w-4 {activeTab === tab.id ? 'text-neutral-700' : 'text-neutral-400'}"
			/>
			{tab.label}
			{#if tab.id === 'run' && runStatus === 'running'}
				<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"></span>
			{/if}
		</button>
	{/each}
</div>

<div class="max-w-3xl">
	<!-- Overview Tab -->
	{#if activeTab === 'overview'}
		<div class="grid gap-4 sm:grid-cols-2">
			<!-- Device Specs -->
			<div class="rounded-xl border border-neutral-200 p-5">
				<div class="mb-3 flex items-center gap-2">
					<Icon icon="ph:device-mobile-duotone" class="h-4.5 w-4.5 text-neutral-400" />
					<h3 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
						Device Info
					</h3>
				</div>
				<dl class="space-y-2.5">
					{#if deviceData?.model}
						<div class="flex justify-between text-sm">
							<dt class="text-neutral-500">Model</dt>
							<dd class="font-medium">{deviceData.model}</dd>
						</div>
					{/if}
					{#if deviceData?.manufacturer}
						<div class="flex justify-between text-sm">
							<dt class="text-neutral-500">Manufacturer</dt>
							<dd class="font-medium">{deviceData.manufacturer}</dd>
						</div>
					{/if}
					{#if deviceData?.androidVersion}
						<div class="flex justify-between text-sm">
							<dt class="text-neutral-500">Android</dt>
							<dd class="font-medium">{deviceData.androidVersion}</dd>
						</div>
					{/if}
					{#if deviceData?.screenWidth && deviceData?.screenHeight}
						<div class="flex justify-between text-sm">
							<dt class="text-neutral-500">Resolution</dt>
							<dd class="font-medium">{deviceData.screenWidth} x {deviceData.screenHeight}</dd>
						</div>
					{/if}
					{#if battery !== null && battery >= 0}
						<div class="flex justify-between text-sm">
							<dt class="text-neutral-500">Battery</dt>
							<dd class="flex items-center gap-1.5 font-medium {battery <= 20 ? 'text-red-600' : ''}">
								<Icon
									icon={charging ? 'ph:battery-charging-duotone' : battery > 50 ? 'ph:battery-high-duotone' : 'ph:battery-low-duotone'}
									class="h-4 w-4"
								/>
								{battery}%{charging ? ' Charging' : ''}
							</dd>
						</div>
					{/if}
					<div class="flex justify-between text-sm">
						<dt class="text-neutral-500">Last seen</dt>
						<dd class="font-medium">
							{deviceData ? relativeTime(deviceData.lastSeen) : '\u2014'}
						</dd>
					</div>
				</dl>
			</div>

			<!-- Stats -->
			<div class="rounded-xl border border-neutral-200 p-5">
				<div class="mb-3 flex items-center gap-2">
					<Icon icon="ph:chart-bar-duotone" class="h-4.5 w-4.5 text-neutral-400" />
					<h3 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
						Stats
					</h3>
				</div>
				<div class="grid grid-cols-3 gap-3 text-center">
					<div class="rounded-lg bg-neutral-50 p-3">
						<div class="mb-1 flex justify-center">
							<Icon icon="ph:stack-duotone" class="h-5 w-5 text-neutral-400" />
						</div>
						<p class="text-2xl font-bold">{stats?.totalSessions ?? 0}</p>
						<p class="text-xs text-neutral-500">Sessions</p>
					</div>
					<div class="rounded-lg bg-neutral-50 p-3">
						<div class="mb-1 flex justify-center">
							<Icon icon="ph:chart-line-up-duotone" class="h-5 w-5 text-green-500" />
						</div>
						<p class="text-2xl font-bold">{stats?.successRate ?? 0}%</p>
						<p class="text-xs text-neutral-500">Success</p>
					</div>
					<div class="rounded-lg bg-neutral-50 p-3">
						<div class="mb-1 flex justify-center">
							<Icon icon="ph:footprints-duotone" class="h-5 w-5 text-blue-500" />
						</div>
						<p class="text-2xl font-bold">{stats?.avgSteps ?? 0}</p>
						<p class="text-xs text-neutral-500">Avg Steps</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Installed Apps -->
		{#if deviceData && deviceData.installedApps.length > 0}
			<div class="mt-4 rounded-xl border border-neutral-200">
				<div class="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
					<div class="flex items-center gap-2">
						<Icon icon="ph:grid-four-duotone" class="h-4.5 w-4.5 text-neutral-400" />
						<h3 class="text-sm font-semibold uppercase tracking-wide text-neutral-500">
							Installed Apps
							<span class="ml-1 font-normal normal-case text-neutral-400"
								>({deviceData.installedApps.length})</span
							>
						</h3>
					</div>
					<div class="relative">
						<Icon
							icon="ph:magnifying-glass-duotone"
							class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
						/>
						<input
							type="text"
							bind:value={appSearch}
							placeholder="Search apps..."
							class="w-48 rounded-lg border border-neutral-200 py-1 pl-8 pr-2.5 text-xs focus:border-neutral-400 focus:outline-none"
						/>
					</div>
				</div>
				<div class="max-h-72 overflow-y-auto">
					{#each filteredApps as app (app.packageName)}
						<div
							class="flex items-center justify-between px-5 py-2 text-sm hover:bg-neutral-50"
						>
							<span class="font-medium">{app.label}</span>
							<span class="font-mono text-xs text-neutral-400">{app.packageName}</span>
						</div>
					{:else}
						<p class="px-5 py-3 text-xs text-neutral-400">No apps match "{appSearch}"</p>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Sessions Tab -->
	{:else if activeTab === 'sessions'}
		{#if sessions.length === 0}
			<div class="rounded-xl border border-neutral-200 p-10 text-center">
				<Icon icon="ph:clock-counter-clockwise-duotone" class="mx-auto mb-3 h-8 w-8 text-neutral-300" />
				<p class="text-sm text-neutral-500">No sessions yet. Go to the Run tab to send a goal.</p>
			</div>
		{:else}
			<div class="divide-y divide-neutral-100 rounded-xl border border-neutral-200">
				{#each sessions as sess (sess.id)}
					<div>
						<button
							onclick={() => toggleSession(sess.id)}
							class="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-neutral-50"
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{sess.goal}</p>
								<p class="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-400">
									<Icon icon="ph:clock-duotone" class="h-3.5 w-3.5" />
									{formatTime(sess.startedAt)} &middot; {sess.stepsUsed} steps
								</p>
							</div>
							<span
								class="ml-3 flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium {sess.status ===
								'completed'
									? 'bg-green-50 text-green-700'
									: sess.status === 'running'
										? 'bg-amber-50 text-amber-700'
										: 'bg-red-50 text-red-700'}"
							>
								<Icon
									icon={sess.status === 'completed'
										? 'ph:check-circle-duotone'
										: sess.status === 'running'
											? 'ph:circle-notch-duotone'
											: 'ph:x-circle-duotone'}
									class="h-3.5 w-3.5"
								/>
								{sess.status === 'completed'
									? 'Success'
									: sess.status === 'running'
										? 'Running'
										: 'Failed'}
							</span>
						</button>
						{#if expandedSession === sess.id}
							<div class="border-t border-neutral-100 bg-neutral-50 px-5 py-3">
								{#if sessionSteps.has(sess.id)}
									<div class="space-y-2">
										{#each sessionSteps.get(sess.id) ?? [] as s (s.id)}
											<div class="flex items-baseline gap-2">
												<span
													class="shrink-0 rounded bg-neutral-200 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500"
												>
													{s.stepNumber}
												</span>
												<div class="min-w-0">
													<span class="font-mono text-xs font-medium"
														>{JSON.stringify(s.action)}</span
													>
													{#if s.reasoning}
														<p class="truncate text-xs text-neutral-400">
															{s.reasoning}
														</p>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<p class="text-xs text-neutral-400">Loading steps...</p>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Run Tab -->
	{:else if activeTab === 'run'}
		<!-- Goal Input -->
		<div class="mb-6 rounded-xl border border-neutral-200 p-5">
			<div class="mb-3 flex items-center gap-2">
				<Icon icon="ph:target-duotone" class="h-4.5 w-4.5 text-neutral-500" />
				<h3 class="text-sm font-semibold">Send a Goal</h3>
			</div>
			<div class="flex gap-3">
				<input
					type="text"
					bind:value={goal}
					placeholder="e.g., Open YouTube and search for lofi beats"
					class="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
					disabled={runStatus === 'running'}
					onkeydown={(e) => e.key === 'Enter' && submitGoal()}
				/>
				{#if runStatus === 'running'}
					<button
						onclick={stopGoal}
						class="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
					>
						<Icon icon="ph:stop-duotone" class="h-4 w-4" />
						Stop
					</button>
				{:else}
					<button
						onclick={submitGoal}
						class="flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
					>
						<Icon icon="ph:play-duotone" class="h-4 w-4" />
						Run
					</button>
				{/if}
			</div>
		</div>

		<!-- Live Steps -->
		{#if steps.length > 0 || runStatus !== 'idle'}
			<div class="rounded-xl border border-neutral-200">
				<div
					class="flex items-center justify-between border-b border-neutral-200 px-5 py-3"
				>
					<h3 class="flex items-center gap-2 text-sm font-semibold">
						<Icon icon="ph:list-checks-duotone" class="h-4.5 w-4.5 text-neutral-400" />
						{currentGoal ? `Goal: ${currentGoal}` : 'Current Run'}
					</h3>
					{#if runStatus === 'running'}
						<span class="flex items-center gap-1.5 text-xs font-medium text-amber-600">
							<span
								class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
							></span>
							Running
						</span>
					{:else if runStatus === 'completed'}
						<span class="flex items-center gap-1.5 text-xs font-medium text-green-600">
							<Icon icon="ph:check-circle-duotone" class="h-4 w-4" />
							Completed
						</span>
					{:else if runStatus === 'failed'}
						<span class="flex items-center gap-1.5 text-xs font-medium text-red-600">
							<Icon icon="ph:x-circle-duotone" class="h-4 w-4" />
							Failed
						</span>
					{/if}
				</div>
				{#if runError}
					<div class="flex items-center gap-2 border-t border-red-100 bg-red-50 px-5 py-3 text-xs text-red-700">
						<Icon icon="ph:warning-duotone" class="h-4 w-4 shrink-0" />
						{runError}
					</div>
				{/if}
				{#if steps.length > 0}
					<div class="divide-y divide-neutral-100">
						{#each steps as s (s.step)}
							<div class="px-5 py-2.5">
								<div class="flex items-baseline gap-2">
									<span
										class="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500"
									>
										{s.step}
									</span>
									<span class="font-mono text-xs font-medium">{s.action}</span>
								</div>
								{#if s.reasoning}
									<p class="mt-0.5 pl-7 text-xs text-neutral-500">{s.reasoning}</p>
								{/if}
							</div>
						{/each}
					</div>
				{:else}
					<div class="flex items-center gap-2 px-5 py-3 text-xs text-neutral-400">
						<Icon icon="ph:circle-notch-duotone" class="h-4 w-4 animate-spin" />
						Waiting for first step...
					</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

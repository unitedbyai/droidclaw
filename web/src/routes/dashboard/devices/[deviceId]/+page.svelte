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
		{ id: 'overview' as const, label: 'Overview', icon: 'solar:info-circle-bold-duotone' },
		{ id: 'sessions' as const, label: 'Sessions', icon: 'solar:history-bold-duotone' },
		{ id: 'run' as const, label: 'Run', icon: 'solar:play-bold-duotone' }
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
		class="flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-white hover:text-stone-600"
	>
		<Icon icon="solar:alt-arrow-left-linear" class="h-5 w-5" />
	</a>
	<div class="flex items-center gap-3">
		<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full {deviceData?.status === 'online' ? 'bg-emerald-100' : 'bg-stone-200'}">
			<Icon icon="solar:smartphone-bold-duotone" class="h-5 w-5 {deviceData?.status === 'online' ? 'text-emerald-600' : 'text-stone-400'}" />
		</div>
		<div>
			<h2 class="text-2xl font-bold">{deviceData?.model ?? deviceId.slice(0, 8)}</h2>
			{#if deviceData?.manufacturer}
				<p class="text-sm text-stone-500">{deviceData.manufacturer}</p>
			{/if}
		</div>
		<span
			class="ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
				{deviceData?.status === 'online'
				? 'bg-emerald-50 text-emerald-700'
				: 'bg-stone-200 text-stone-500'}"
		>
			<span
				class="inline-block h-1.5 w-1.5 rounded-full {deviceData?.status === 'online'
					? 'bg-emerald-500'
					: 'bg-stone-400'}"
			></span>
			{deviceData?.status === 'online' ? 'Online' : 'Offline'}
		</span>
	</div>
</div>

<!-- Tabs -->
<div class="mb-6 flex gap-1 rounded-full bg-white p-1">
	{#each tabs as tab}
		<button
			onclick={() => {
				activeTab = tab.id;
				track(DEVICE_TAB_CHANGE, { tab: tab.id });
			}}
			class="flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors
				{activeTab === tab.id
				? 'bg-stone-900 text-white'
				: 'text-stone-500 hover:text-stone-700'}"
		>
			<Icon
				icon={tab.icon}
				class="h-4 w-4 {activeTab === tab.id ? 'text-white' : 'text-stone-400'}"
			/>
			{tab.label}
			{#if tab.id === 'run' && runStatus === 'running'}
				<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"></span>
			{/if}
		</button>
	{/each}
</div>

<!-- Overview Tab -->
{#if activeTab === 'overview'}
	<div class="grid gap-4 sm:grid-cols-2">
		<!-- Device Specs -->
		<div>
			<p class="mb-3 text-sm font-medium text-stone-500">Device info</p>
			<div class="rounded-2xl bg-white">
				{#if deviceData?.model}
					<div class="flex justify-between px-6 py-3.5 text-sm">
						<span class="text-stone-500">Model</span>
						<span class="font-medium text-stone-900">{deviceData.model}</span>
					</div>
				{/if}
				{#if deviceData?.manufacturer}
					<div class="flex justify-between border-t border-stone-100 px-6 py-3.5 text-sm">
						<span class="text-stone-500">Manufacturer</span>
						<span class="font-medium text-stone-900">{deviceData.manufacturer}</span>
					</div>
				{/if}
				{#if deviceData?.androidVersion}
					<div class="flex justify-between border-t border-stone-100 px-6 py-3.5 text-sm">
						<span class="text-stone-500">Android</span>
						<span class="font-medium text-stone-900">{deviceData.androidVersion}</span>
					</div>
				{/if}
				{#if deviceData?.screenWidth && deviceData?.screenHeight}
					<div class="flex justify-between border-t border-stone-100 px-6 py-3.5 text-sm">
						<span class="text-stone-500">Resolution</span>
						<span class="font-medium text-stone-900">{deviceData.screenWidth} &times; {deviceData.screenHeight}</span>
					</div>
				{/if}
				{#if battery !== null && battery >= 0}
					<div class="flex justify-between border-t border-stone-100 px-6 py-3.5 text-sm">
						<span class="text-stone-500">Battery</span>
						<span class="flex items-center gap-1.5 font-medium {battery <= 20 ? 'text-red-600' : 'text-stone-900'}">
							<Icon
								icon={charging ? 'solar:battery-charge-bold-duotone' : battery > 50 ? 'solar:battery-full-bold-duotone' : 'solar:battery-low-bold-duotone'}
								class="h-4 w-4"
							/>
							{battery}%{charging ? ' Charging' : ''}
						</span>
					</div>
				{/if}
				<div class="flex justify-between border-t border-stone-100 px-6 py-3.5 text-sm">
					<span class="text-stone-500">Last seen</span>
					<span class="font-medium text-stone-900">
						{deviceData ? relativeTime(deviceData.lastSeen) : '\u2014'}
					</span>
				</div>
			</div>
		</div>

		<!-- Stats -->
		<div>
			<p class="mb-3 text-sm font-medium text-stone-500">Stats</p>
			<div class="rounded-2xl bg-white p-5">
				<div class="grid grid-cols-3 gap-3 text-center">
					<div class="rounded-xl bg-stone-50 p-4">
						<div class="mb-1.5 flex justify-center">
							<div class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100">
								<Icon icon="solar:layers-bold-duotone" class="h-4 w-4 text-blue-600" />
							</div>
						</div>
						<p class="text-2xl font-bold text-stone-900">{stats?.totalSessions ?? 0}</p>
						<p class="text-xs text-stone-500">Sessions</p>
					</div>
					<div class="rounded-xl bg-stone-50 p-4">
						<div class="mb-1.5 flex justify-center">
							<div class="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
								<Icon icon="solar:chart-2-bold-duotone" class="h-4 w-4 text-emerald-600" />
							</div>
						</div>
						<p class="text-2xl font-bold text-stone-900">{stats?.successRate ?? 0}%</p>
						<p class="text-xs text-stone-500">Success</p>
					</div>
					<div class="rounded-xl bg-stone-50 p-4">
						<div class="mb-1.5 flex justify-center">
							<div class="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100">
								<Icon icon="solar:routing-bold-duotone" class="h-4 w-4 text-purple-600" />
							</div>
						</div>
						<p class="text-2xl font-bold text-stone-900">{stats?.avgSteps ?? 0}</p>
						<p class="text-xs text-stone-500">Avg Steps</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Installed Apps -->
	{#if deviceData && deviceData.installedApps.length > 0}
		<div class="mt-6">
			<div class="mb-3 flex items-center justify-between">
				<p class="text-sm font-medium text-stone-500">
					Installed apps
					<span class="text-stone-400">({deviceData.installedApps.length})</span>
				</p>
				<div class="relative">
					<Icon
						icon="solar:magnifer-bold-duotone"
						class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
					/>
					<input
						type="text"
						bind:value={appSearch}
						placeholder="Search apps..."
						class="w-48 rounded-lg border border-stone-200 bg-white py-1.5 pl-8 pr-2.5 text-xs focus:border-stone-400 focus:outline-none"
					/>
				</div>
			</div>
			<div class="max-h-72 overflow-y-auto rounded-2xl bg-white">
				{#each filteredApps as app, i (app.packageName)}
					<div
						class="flex items-center justify-between px-6 py-3 text-sm hover:bg-stone-50
							{i > 0 ? 'border-t border-stone-100' : ''}"
					>
						<span class="font-medium text-stone-900">{app.label}</span>
						<span class="font-mono text-xs text-stone-400">{app.packageName}</span>
					</div>
				{:else}
					<p class="px-6 py-4 text-xs text-stone-400">No apps match "{appSearch}"</p>
				{/each}
			</div>
		</div>
	{/if}

<!-- Sessions Tab -->
{:else if activeTab === 'sessions'}
	{#if sessions.length === 0}
		<div class="rounded-2xl bg-white p-10 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
				<Icon icon="solar:history-bold-duotone" class="h-6 w-6 text-stone-400" />
			</div>
			<p class="text-sm text-stone-500">No sessions yet. Go to the Run tab to send a goal.</p>
		</div>
	{:else}
		<p class="mb-3 text-sm font-medium text-stone-500">Session history</p>
		<div class="rounded-2xl bg-white">
			{#each sessions as sess, i (sess.id)}
				<div class={i > 0 ? 'border-t border-stone-100' : ''}>
					<button
						onclick={() => toggleSession(sess.id)}
						class="flex w-full items-center justify-between px-6 py-4 text-left transition-colors hover:bg-stone-50
							{i === 0 ? 'rounded-t-2xl' : ''}
							{i === sessions.length - 1 && expandedSession !== sess.id ? 'rounded-b-2xl' : ''}"
					>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-stone-900">{sess.goal}</p>
							<p class="mt-0.5 flex items-center gap-1.5 text-xs text-stone-400">
								<Icon icon="solar:clock-circle-bold-duotone" class="h-3.5 w-3.5" />
								{formatTime(sess.startedAt)} &middot; {sess.stepsUsed} steps
							</p>
						</div>
						<span
							class="ml-3 flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium {sess.status ===
							'completed'
								? 'bg-emerald-50 text-emerald-700'
								: sess.status === 'running'
									? 'bg-amber-50 text-amber-700'
									: 'bg-red-50 text-red-700'}"
						>
							<Icon
								icon={sess.status === 'completed'
									? 'solar:check-circle-bold-duotone'
									: sess.status === 'running'
										? 'solar:refresh-circle-bold-duotone'
										: 'solar:close-circle-bold-duotone'}
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
						<div class="border-t border-stone-100 bg-stone-50 px-6 py-4
							{i === sessions.length - 1 ? 'rounded-b-2xl' : ''}">
							{#if sessionSteps.has(sess.id)}
								<div class="space-y-2.5">
									{#each sessionSteps.get(sess.id) ?? [] as s (s.id)}
										<div class="flex items-baseline gap-2.5">
											<span
												class="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-500"
											>
												{s.stepNumber}
											</span>
											<div class="min-w-0">
												<span class="font-mono text-xs font-medium text-stone-800"
													>{JSON.stringify(s.action)}</span
												>
												{#if s.reasoning}
													<p class="truncate text-xs text-stone-400">
														{s.reasoning}
													</p>
												{/if}
											</div>
										</div>
									{/each}
								</div>
							{:else}
								<p class="text-xs text-stone-400">Loading steps...</p>
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
	<p class="mb-3 text-sm font-medium text-stone-500">Send a goal</p>
	<div class="mb-6 rounded-2xl bg-white p-6">
		<div class="flex gap-3">
			<input
				type="text"
				bind:value={goal}
				placeholder="e.g., Open YouTube and search for lofi beats"
				class="flex-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
				disabled={runStatus === 'running'}
				onkeydown={(e) => e.key === 'Enter' && submitGoal()}
			/>
			{#if runStatus === 'running'}
				<button
					onclick={stopGoal}
					class="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
				>
					<Icon icon="solar:stop-bold" class="h-4 w-4" />
					Stop
				</button>
			{:else}
				<button
					onclick={submitGoal}
					class="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
				>
					<Icon icon="solar:play-bold" class="h-4 w-4" />
					Run
				</button>
			{/if}
		</div>
	</div>

	<!-- Live Steps -->
	{#if steps.length > 0 || runStatus !== 'idle'}
		<p class="mb-3 text-sm font-medium text-stone-500">
			{currentGoal ? currentGoal : 'Current run'}
		</p>
		<div class="rounded-2xl bg-white">
			<!-- Status bar -->
			<div class="flex items-center justify-between px-6 py-3.5">
				<span class="text-sm font-medium text-stone-900">
					{steps.length} step{steps.length !== 1 ? 's' : ''}
				</span>
				{#if runStatus === 'running'}
					<span class="flex items-center gap-1.5 text-xs font-medium text-amber-600">
						<span
							class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
						></span>
						Running
					</span>
				{:else if runStatus === 'completed'}
					<span class="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
						<Icon icon="solar:check-circle-bold-duotone" class="h-4 w-4" />
						Completed
					</span>
				{:else if runStatus === 'failed'}
					<span class="flex items-center gap-1.5 text-xs font-medium text-red-600">
						<Icon icon="solar:close-circle-bold-duotone" class="h-4 w-4" />
						Failed
					</span>
				{/if}
			</div>

			{#if runError}
				<div class="flex items-center gap-2 border-t border-red-100 bg-red-50 px-6 py-3 text-xs text-red-700">
					<Icon icon="solar:danger-triangle-bold-duotone" class="h-4 w-4 shrink-0" />
					{runError}
				</div>
			{/if}

			{#if steps.length > 0}
				{#each steps as s (s.step)}
					<div class="border-t border-stone-100 px-6 py-3">
						<div class="flex items-baseline gap-2.5">
							<span
								class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] text-stone-500"
							>
								{s.step}
							</span>
							<span class="font-mono text-xs font-medium text-stone-800">{s.action}</span>
						</div>
						{#if s.reasoning}
							<p class="mt-0.5 pl-8 text-xs text-stone-500">{s.reasoning}</p>
						{/if}
					</div>
				{/each}
			{:else}
				<div class="flex items-center gap-2 border-t border-stone-100 px-6 py-4 text-xs text-stone-400">
					<Icon icon="solar:refresh-circle-bold-duotone" class="h-4 w-4 animate-spin" />
					Waiting for first step...
				</div>
			{/if}
		</div>
	{/if}
{/if}

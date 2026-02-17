<script lang="ts">
	import { page } from '$app/state';
	import {
		getDevice,
		listDeviceSessions,
		listSessionSteps,
		getDeviceStats
	} from '$lib/api/devices.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import { onMount } from 'svelte';

	const deviceId = page.params.deviceId!;

	// Tabs
	let activeTab = $state<'overview' | 'sessions' | 'run'>('overview');

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
		if (!sessionSteps.has(sessionId)) {
			const loadedSteps = await listSessionSteps({ deviceId, sessionId });
			sessionSteps.set(sessionId, loadedSteps as Step[]);
			sessionSteps = new Map(sessionSteps);
		}
	}

	async function submitGoal() {
		if (!goal.trim()) return;
		runStatus = 'running';
		currentGoal = goal;
		steps = [];

		const res = await fetch('/api/goals', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ deviceId, goal })
		});

		if (!res.ok) {
			runStatus = 'failed';
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

	const battery = $derived(liveBattery ?? (deviceData?.batteryLevel as number | null));
	const charging = $derived(liveCharging || (deviceData?.isCharging as boolean));
</script>

<!-- Header -->
<div class="mb-6 flex items-center gap-3">
	<a href="/dashboard/devices" class="text-neutral-400 hover:text-neutral-600">&larr;</a>
	<div>
		<h2 class="text-2xl font-bold">{deviceData?.model ?? deviceId.slice(0, 8)}</h2>
		{#if deviceData?.manufacturer}
			<p class="text-sm text-neutral-500">{deviceData.manufacturer}</p>
		{/if}
	</div>
	<span
		class="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs
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
<div class="mb-6 flex gap-1 rounded-lg bg-neutral-100 p-1">
	{#each [['overview', 'Overview'], ['sessions', 'Sessions'], ['run', 'Run']] as [tab, label]}
		<button
			onclick={() => (activeTab = tab as typeof activeTab)}
			class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors
				{activeTab === tab
				? 'bg-white text-neutral-900 shadow-sm'
				: 'text-neutral-500 hover:text-neutral-700'}"
		>
			{label}
			{#if tab === 'run' && runStatus === 'running'}
				<span class="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
				></span>
			{/if}
		</button>
	{/each}
</div>

<div class="max-w-3xl">
	<!-- Overview Tab -->
	{#if activeTab === 'overview'}
		<div class="grid gap-4 sm:grid-cols-2">
			<!-- Device Specs -->
			<div class="rounded-lg border border-neutral-200 p-5">
				<h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
					Device Info
				</h3>
				<dl class="space-y-2">
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
							<dd class="font-medium {battery <= 20 ? 'text-red-600' : ''}">
								{battery}%{charging ? ' (Charging)' : ''}
							</dd>
						</div>
					{/if}
					<div class="flex justify-between text-sm">
						<dt class="text-neutral-500">Last seen</dt>
						<dd class="font-medium">
							{deviceData ? relativeTime(deviceData.lastSeen) : '—'}
						</dd>
					</div>
				</dl>
			</div>

			<!-- Stats -->
			<div class="rounded-lg border border-neutral-200 p-5">
				<h3 class="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">
					Stats
				</h3>
				<div class="grid grid-cols-3 gap-3 text-center">
					<div>
						<p class="text-2xl font-bold">{stats?.totalSessions ?? 0}</p>
						<p class="text-xs text-neutral-500">Sessions</p>
					</div>
					<div>
						<p class="text-2xl font-bold">{stats?.successRate ?? 0}%</p>
						<p class="text-xs text-neutral-500">Success</p>
					</div>
					<div>
						<p class="text-2xl font-bold">{stats?.avgSteps ?? 0}</p>
						<p class="text-xs text-neutral-500">Avg Steps</p>
					</div>
				</div>
			</div>
		</div>

		<!-- Sessions Tab -->
	{:else if activeTab === 'sessions'}
		{#if sessions.length === 0}
			<p class="text-sm text-neutral-400">No sessions yet. Go to the Run tab to send a goal.</p>
		{:else}
			<div class="divide-y divide-neutral-100 rounded-lg border border-neutral-200">
				{#each sessions as sess (sess.id)}
					<div>
						<button
							onclick={() => toggleSession(sess.id)}
							class="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-neutral-50"
						>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{sess.goal}</p>
								<p class="mt-0.5 text-xs text-neutral-400">
									{formatTime(sess.startedAt)} &middot; {sess.stepsUsed} steps
								</p>
							</div>
							<span
								class="ml-3 shrink-0 rounded px-2 py-0.5 text-xs {sess.status === 'completed'
									? 'bg-green-50 text-green-700'
									: sess.status === 'running'
										? 'bg-amber-50 text-amber-700'
										: 'bg-red-50 text-red-700'}"
							>
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
		<div class="mb-6 rounded-lg border border-neutral-200 p-5">
			<h3 class="mb-3 text-sm font-semibold">Send a Goal</h3>
			<div class="flex gap-3">
				<input
					type="text"
					bind:value={goal}
					placeholder="e.g., Open YouTube and search for lofi beats"
					class="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
					disabled={runStatus === 'running'}
					onkeydown={(e) => e.key === 'Enter' && submitGoal()}
				/>
				<button
					onclick={submitGoal}
					disabled={runStatus === 'running'}
					class="rounded bg-neutral-800 px-4 py-2 text-sm text-white hover:bg-neutral-700 disabled:opacity-50"
				>
					{runStatus === 'running' ? 'Running...' : 'Run'}
				</button>
			</div>
		</div>

		<!-- Live Steps -->
		{#if steps.length > 0 || runStatus !== 'idle'}
			<div class="rounded-lg border border-neutral-200">
				<div
					class="flex items-center justify-between border-b border-neutral-200 px-5 py-3"
				>
					<h3 class="text-sm font-semibold">
						{currentGoal ? `Goal: ${currentGoal}` : 'Current Run'}
					</h3>
					{#if runStatus === 'running'}
						<span class="flex items-center gap-1.5 text-xs text-amber-600">
							<span
								class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
							></span>
							Running
						</span>
					{:else if runStatus === 'completed'}
						<span class="text-xs text-green-600">Completed</span>
					{:else if runStatus === 'failed'}
						<span class="text-xs text-red-600">Failed</span>
					{/if}
				</div>
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
					<div class="px-5 py-3 text-xs text-neutral-400">Waiting for first step...</div>
				{/if}
			</div>
		{/if}
	{/if}
</div>

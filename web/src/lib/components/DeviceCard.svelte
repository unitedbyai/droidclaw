<script lang="ts">
	import Icon from '@iconify/svelte';
	import { DEVICE_CARD_CLICK } from '$lib/analytics/events';

	interface Props {
		deviceId: string;
		name: string;
		status: 'online' | 'offline';
		model: string | null;
		manufacturer: string | null;
		androidVersion: string | null;
		screenWidth: number | null;
		screenHeight: number | null;
		batteryLevel: number | null;
		isCharging: boolean;
		lastSeen: string;
		lastGoal: { goal: string; status: string; startedAt: string } | null;
	}

	let {
		deviceId,
		name,
		status,
		model,
		manufacturer,
		androidVersion,
		batteryLevel,
		isCharging,
		screenWidth,
		screenHeight,
		lastSeen,
		lastGoal
	}: Props = $props();

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

	function batteryIcon(level: number | null, charging: boolean): string {
		if (level === null || level < 0) return 'ph:battery-empty-duotone';
		if (charging) return 'ph:battery-charging-duotone';
		if (level > 75) return 'ph:battery-full-duotone';
		if (level > 50) return 'ph:battery-high-duotone';
		if (level > 25) return 'ph:battery-medium-duotone';
		return 'ph:battery-low-duotone';
	}
</script>

<a href="/dashboard/devices/{deviceId}" data-umami-event={DEVICE_CARD_CLICK} data-umami-event-device={model ?? name} class="group block">
	<!-- Phone frame -->
	<div
		class="relative mx-auto w-48 overflow-hidden rounded-[2rem] border-2 bg-white transition-all
			{status === 'online'
			? 'border-green-400 shadow-[0_0_15px_rgba(74,222,128,0.2)]'
			: 'border-neutral-200 opacity-60'}
			group-hover:shadow-lg"
		style="aspect-ratio: 9 / 18;"
	>
		<!-- Notch -->
		<div
			class="absolute left-1/2 top-2 h-1.5 w-12 -translate-x-1/2 rounded-full bg-neutral-200"
		></div>

		<!-- Status bar -->
		<div class="flex items-center justify-between px-4 pb-2 pt-5">
			<div class="flex items-center gap-1">
				<span
					class="inline-block h-1.5 w-1.5 rounded-full {status === 'online'
						? 'bg-green-500'
						: 'bg-neutral-300'}"
				></span>
				<span class="text-[10px] text-neutral-400"
					>{status === 'online' ? 'Online' : 'Offline'}</span
				>
			</div>
			{#if batteryLevel !== null && batteryLevel >= 0}
				<div class="flex items-center gap-0.5">
					<Icon
						icon={batteryIcon(batteryLevel, isCharging)}
						class="h-3.5 w-3.5 {batteryLevel <= 20 ? 'text-red-500' : 'text-neutral-400'}"
					/>
					<span class="text-[10px] {batteryLevel <= 20 ? 'text-red-500' : 'text-neutral-400'}">
						{batteryLevel}%
					</span>
				</div>
			{/if}
		</div>

		<!-- Body -->
		<div class="flex flex-1 flex-col items-center px-4 pt-4">
			<!-- Device icon -->
			<div class="mb-2 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-100">
				<Icon icon="ph:device-mobile-duotone" class="h-5 w-5 text-neutral-500" />
			</div>

			<!-- Device name -->
			<p class="text-center text-xs font-semibold leading-tight text-neutral-800">
				{model ?? name}
			</p>
			{#if manufacturer}
				<p class="text-[10px] text-neutral-400">{manufacturer}</p>
			{/if}

			<!-- Specs -->
			<div class="mt-2 flex flex-wrap justify-center gap-1">
				{#if androidVersion}
					<span class="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500">
						Android {androidVersion}
					</span>
				{/if}
				{#if screenWidth && screenHeight}
					<span class="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[9px] text-neutral-500">
						{screenWidth}x{screenHeight}
					</span>
				{/if}
			</div>
		</div>

		<!-- Footer: last goal -->
		<div
			class="absolute bottom-0 left-0 right-0 border-t border-neutral-100 bg-neutral-50/80 px-3 py-2"
		>
			{#if lastGoal}
				<p class="truncate text-[10px] text-neutral-600">{lastGoal.goal}</p>
				<div class="mt-0.5 flex items-center justify-between">
					<span
						class="flex items-center gap-0.5 text-[9px] font-medium {lastGoal.status === 'completed'
							? 'text-green-600'
							: lastGoal.status === 'running'
								? 'text-amber-600'
								: 'text-red-500'}"
					>
						<Icon
							icon={lastGoal.status === 'completed'
								? 'ph:check-circle-duotone'
								: lastGoal.status === 'running'
									? 'ph:circle-notch-duotone'
									: 'ph:x-circle-duotone'}
							class="h-3 w-3"
						/>
						{lastGoal.status === 'completed'
							? 'Success'
							: lastGoal.status === 'running'
								? 'Running'
								: 'Failed'}
					</span>
					<span class="text-[9px] text-neutral-400">{relativeTime(lastGoal.startedAt)}</span>
				</div>
			{:else}
				<p class="text-[10px] italic text-neutral-400">No goals yet</p>
			{/if}
		</div>

		<!-- Home indicator -->
		<div
			class="absolute bottom-8 left-1/2 h-1 w-8 -translate-x-1/2 rounded-full bg-neutral-200"
		></div>
	</div>
</a>

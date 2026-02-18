<script lang="ts">
	import Icon from '@iconify/svelte';
	import { DASHBOARD_CARD_CLICK } from '$lib/analytics/events';

	let { data } = $props();

	const cards = [
		{
			href: '/dashboard/devices',
			icon: 'ph:device-mobile-duotone',
			title: 'Devices',
			desc: 'Manage connected phones',
			color: 'text-green-600 bg-green-50'
		},
		{
			href: '/dashboard/api-keys',
			icon: 'ph:key-duotone',
			title: 'API Keys',
			desc: 'Create keys for your devices',
			color: 'text-amber-600 bg-amber-50'
		},
		{
			href: '/dashboard/settings',
			icon: 'ph:gear-duotone',
			title: 'Settings',
			desc: 'Configure LLM provider',
			color: 'text-blue-600 bg-blue-50'
		}
	];
</script>

<h2 class="mb-1 text-2xl font-bold">Dashboard</h2>
<p class="mb-8 text-neutral-500">Welcome back, {data.user.name}.</p>

{#if data.plan}
	<div class="mb-8 flex items-center gap-4 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
		<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100">
			<Icon icon="ph:seal-check-duotone" class="h-5 w-5 text-emerald-600" />
		</div>
		<div>
			<h3 class="font-semibold text-emerald-900">{data.plan === 'ltd' ? 'Lifetime Deal' : data.plan} Plan</h3>
			<p class="mt-0.5 text-sm text-emerald-700">
				License: {data.licenseKey ?? 'Active'}
			</p>
		</div>
	</div>
{/if}

<div class="grid grid-cols-3 gap-5">
	{#each cards as card}
		<a
			href={card.href}
			data-umami-event={DASHBOARD_CARD_CLICK}
			data-umami-event-section={card.title.toLowerCase().replace(' ', '-')}
			class="group flex items-start gap-4 rounded-xl border border-neutral-200 p-5 transition-all hover:border-neutral-300 hover:shadow-sm"
		>
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg {card.color}">
				<Icon icon={card.icon} class="h-5 w-5" />
			</div>
			<div>
				<h3 class="font-semibold text-neutral-900">{card.title}</h3>
				<p class="mt-0.5 text-sm text-neutral-500">{card.desc}</p>
			</div>
		</a>
	{/each}
</div>

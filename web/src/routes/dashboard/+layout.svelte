<script lang="ts">
	import { signout } from '$lib/api/auth.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import { Toaster } from 'svelte-sonner';
	import { AUTH_SIGNOUT, NAV_SIDEBAR_CLICK } from '$lib/analytics/events';

	let { children, data } = $props();

	const navItems = [
		{ href: '/dashboard', label: 'Overview', icon: 'ph:squares-four-duotone', exact: true },
		{ href: '/dashboard/devices', label: 'Devices', icon: 'ph:device-mobile-duotone' },
		{ href: '/dashboard/api-keys', label: 'API Keys', icon: 'ph:key-duotone' },
		{ href: '/dashboard/settings', label: 'Settings', icon: 'ph:gear-duotone' }
	];

	function isActive(href: string, exact: boolean = false) {
		if (exact) return page.url.pathname === href;
		return page.url.pathname.startsWith(href);
	}

	onMount(() => {
		if (data.sessionToken) {
			dashboardWs.connect(data.sessionToken);
		}
		return () => dashboardWs.disconnect();
	});
</script>

<div class="flex min-h-screen">
	<aside class="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50 p-6">
		<div class="mb-8">
			<h1 class="text-lg font-bold tracking-tight">DroidClaw</h1>
		</div>
		<nav class="flex flex-col gap-1">
			{#each navItems as item}
				<a
					href={item.href}
					data-umami-event={NAV_SIDEBAR_CLICK}
					data-umami-event-section={item.label.toLowerCase().replace(' ', '-')}
					class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors
						{isActive(item.href, item.exact)
						? 'bg-neutral-200/70 text-neutral-900'
						: 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'}"
				>
					<Icon
						icon={item.icon}
						class="h-5 w-5 {isActive(item.href, item.exact) ? 'text-neutral-700' : 'text-neutral-400'}"
					/>
					{item.label}
				</a>
			{/each}
		</nav>
		<div class="mt-auto pt-8">
			{#if data.plan}
				<div class="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
					<Icon icon="ph:seal-check-duotone" class="h-4 w-4 text-emerald-600" />
					<span class="text-xs font-semibold uppercase tracking-wide text-emerald-700">{data.plan === 'ltd' ? 'Lifetime' : data.plan}</span>
				</div>
			{/if}
			<form {...signout}>
				<button
					type="submit"
					data-umami-event={AUTH_SIGNOUT}
					class="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
				>
					<Icon icon="ph:sign-out-duotone" class="h-5 w-5" />
					Sign out
				</button>
			</form>
		</div>
	</aside>

	<main class="flex-1 overflow-auto p-8">
		<div class="mx-auto max-w-5xl">
			{@render children?.()}
		</div>
	</main>
</div>

<Toaster position="bottom-right" />

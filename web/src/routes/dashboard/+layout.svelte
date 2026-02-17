<script lang="ts">
	import { signout } from '$lib/api/auth.remote';

	let { children, data } = $props();
</script>

<div class="flex min-h-screen">
	<aside class="flex w-64 flex-col border-r border-neutral-200 bg-neutral-50 p-6">
		<h1 class="mb-8 text-xl font-bold">DroidClaw</h1>
		<nav class="flex flex-col gap-2">
			<a href="/dashboard" class="rounded px-3 py-2 hover:bg-neutral-200">Overview</a>
			<a href="/dashboard/devices" class="rounded px-3 py-2 hover:bg-neutral-200">Devices</a>
			<a href="/dashboard/api-keys" class="rounded px-3 py-2 hover:bg-neutral-200">API Keys</a>
			<a href="/dashboard/settings" class="rounded px-3 py-2 hover:bg-neutral-200">Settings</a>
		</nav>
		<div class="mt-auto pt-8">
			<p class="mb-2 text-sm text-neutral-500">{data.user.email}</p>
			<form {...signout}>
				<button type="submit" class="text-sm text-neutral-500 hover:text-neutral-800">
					Sign out
				</button>
			</form>
		</div>
	</aside>

	<main class="flex-1 p-8">
		{@render children?.()}
	</main>
</div>

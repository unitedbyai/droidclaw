<script lang="ts">
	let { data } = $props();
</script>

<h2 class="mb-6 text-2xl font-bold">Dashboard</h2>
<p class="text-neutral-600">Welcome back, {data.user.name}.</p>

<div class="mt-8 grid grid-cols-3 gap-6">
	<a
		href="/dashboard/devices"
		class="rounded-lg border border-neutral-200 p-6 hover:border-neutral-400"
	>
		<h3 class="font-semibold">Devices</h3>
		<p class="mt-1 text-sm text-neutral-500">Manage connected phones</p>
	</a>
	<a
		href="/dashboard/api-keys"
		class="rounded-lg border border-neutral-200 p-6 hover:border-neutral-400"
	>
		<h3 class="font-semibold">API Keys</h3>
		<p class="mt-1 text-sm text-neutral-500">Create keys for your devices</p>
	</a>
	<a
		href="/dashboard/settings"
		class="rounded-lg border border-neutral-200 p-6 hover:border-neutral-400"
	>
		<h3 class="font-semibold">Settings</h3>
		<p class="mt-1 text-sm text-neutral-500">Configure LLM provider</p>
	</a>
</div>

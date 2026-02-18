<script lang="ts">
	import { listKeys, createKey, deleteKey } from '$lib/api/api-keys.remote';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/toast';
	import { track } from '$lib/analytics/track';
	import { APIKEY_CREATE, APIKEY_COPY, APIKEY_DELETE } from '$lib/analytics/events';

	let newKeyValue = $state<string | null>(null);
	let keysPromise = $state(listKeys());

	$effect(() => {
		if (createKey.result?.key) {
			newKeyValue = createKey.result.key;
			keysPromise = listKeys();
			toast.success('API key created');
			track(APIKEY_CREATE);
		}
	});

	$effect(() => {
		if (deleteKey.result?.deleted) {
			keysPromise = listKeys();
			toast.success('API key deleted');
			track(APIKEY_DELETE);
		}
	});
</script>

<h2 class="mb-6 text-2xl font-bold">API Keys</h2>

<!-- Create new key -->
<div class="mb-8 rounded-xl border border-neutral-200 p-6">
	<div class="mb-4 flex items-center gap-2">
		<Icon icon="ph:plus-circle-duotone" class="h-5 w-5 text-neutral-500" />
		<h3 class="font-semibold">Create New Key</h3>
	</div>
	<form {...createKey} class="flex items-end gap-4">
		<label class="flex flex-1 flex-col gap-1">
			<span class="text-sm text-neutral-600">Key Name</span>
			<input
				{...createKey.fields.name.as('text')}
				placeholder="e.g. Production, Development"
				class="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
			/>
			{#each createKey.fields.name.issues() ?? [] as issue (issue.message)}
				<p class="text-sm text-red-600">{issue.message}</p>
			{/each}
		</label>
		<button
			type="submit"
			class="flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
		>
			<Icon icon="ph:plus-duotone" class="h-4 w-4" />
			Create
		</button>
	</form>
</div>

<!-- Newly created key warning -->
{#if newKeyValue}
	<div class="mb-8 rounded-xl border border-yellow-300 bg-yellow-50 p-6">
		<div class="mb-2 flex items-center gap-2">
			<Icon icon="ph:warning-duotone" class="h-5 w-5 text-yellow-700" />
			<h3 class="font-semibold text-yellow-800">Save Your API Key</h3>
		</div>
		<p class="mb-3 text-sm text-yellow-700">
			Copy this key now. It will not be shown again.
		</p>
		<div class="flex items-center gap-2">
			<code class="flex-1 rounded-lg bg-yellow-100 px-3 py-2 font-mono text-sm break-all">
				{newKeyValue}
			</code>
			<button
				onclick={() => {
					navigator.clipboard.writeText(newKeyValue!);
					toast.success('Copied to clipboard');
					track(APIKEY_COPY);
				}}
				class="flex items-center gap-1.5 rounded-lg border border-yellow-400 px-3 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-100"
			>
				<Icon icon="ph:copy-duotone" class="h-4 w-4" />
				Copy
			</button>
		</div>
		<button
			onclick={() => (newKeyValue = null)}
			class="mt-3 text-sm text-yellow-600 hover:text-yellow-800"
		>
			Dismiss
		</button>
	</div>
{/if}

<!-- Existing keys list -->
<div class="rounded-xl border border-neutral-200">
	<div class="flex items-center gap-2 border-b border-neutral-200 px-6 py-4">
		<Icon icon="ph:key-duotone" class="h-5 w-5 text-neutral-400" />
		<h3 class="font-semibold">Your Keys</h3>
	</div>

	{#await keysPromise}
		<div class="flex items-center justify-center gap-2 px-6 py-8 text-sm text-neutral-500">
			<Icon icon="ph:circle-notch-duotone" class="h-5 w-5 animate-spin text-neutral-400" />
			Loading keys...
		</div>
	{:then keys}
		{#if keys && keys.length > 0}
			<ul class="divide-y divide-neutral-100">
				{#each keys as key (key.id)}
					<li class="flex items-center justify-between px-6 py-4">
						<div class="flex items-center gap-3">
							<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-neutral-100">
								<Icon icon="ph:key-duotone" class="h-4 w-4 text-neutral-400" />
							</div>
							<div>
								<p class="font-medium">{key.name ?? 'Unnamed Key'}</p>
								<div class="mt-0.5 flex items-center gap-3 text-sm text-neutral-500">
									{#if key.start}
										<span class="font-mono">{key.start}...</span>
									{/if}
									<span>
										Created {new Date(key.createdAt).toLocaleDateString()}
									</span>
								</div>
							</div>
						</div>
						<form {...deleteKey}>
							<input type="hidden" name="keyId" value={key.id} />
							<button
								type="submit"
								class="flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
							>
								<Icon icon="ph:trash-duotone" class="h-4 w-4" />
								Delete
							</button>
						</form>
					</li>
				{/each}
			</ul>
		{:else}
			<div class="px-6 py-10 text-center">
				<Icon icon="ph:key-duotone" class="mx-auto mb-3 h-8 w-8 text-neutral-300" />
				<p class="text-sm text-neutral-500">No API keys yet. Create one above.</p>
			</div>
		{/if}
	{:catch}
		<div class="flex items-center justify-center gap-2 px-6 py-8 text-sm text-red-600">
			<Icon icon="ph:warning-duotone" class="h-5 w-5" />
			Failed to load keys. Please try again.
		</div>
	{/await}
</div>

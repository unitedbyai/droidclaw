<script lang="ts">
	import { getConfig, updateConfig } from '$lib/api/settings.remote';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/toast';
	import { track } from '$lib/analytics/track';
	import { SETTINGS_SAVE } from '$lib/analytics/events';

	const config = await getConfig();
	const layoutData = page.data;

	$effect(() => {
		if (updateConfig.result?.saved) {
			toast.success('Settings saved');
			track(SETTINGS_SAVE);
		}
	});
</script>

<h2 class="mb-6 text-2xl font-bold">Settings</h2>

<div class="mb-6 max-w-lg rounded-xl border border-neutral-200 p-6">
	<div class="mb-4 flex items-center gap-2">
		<Icon icon="ph:user-duotone" class="h-5 w-5 text-neutral-500" />
		<h3 class="font-semibold">Account</h3>
	</div>
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<span class="text-sm text-neutral-500">Email</span>
			<span class="text-sm font-medium text-neutral-900 blur-sm transition-all duration-200 hover:blur-none">{layoutData.user.email}</span>
		</div>
		{#if layoutData.plan}
			<div class="flex items-center justify-between">
				<span class="text-sm text-neutral-500">Plan</span>
				<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
					<Icon icon="ph:seal-check-duotone" class="h-3.5 w-3.5" />
					{layoutData.plan === 'ltd' ? 'Lifetime' : layoutData.plan}
				</span>
			</div>
		{/if}
		{#if layoutData.licenseKey}
			<div class="flex items-center justify-between">
				<span class="text-sm text-neutral-500">License</span>
				<span class="font-mono text-sm text-neutral-600">{layoutData.licenseKey}</span>
			</div>
		{/if}
	</div>
</div>

<div class="max-w-lg rounded-xl border border-neutral-200 p-6">
	<div class="mb-4 flex items-center gap-2">
		<Icon icon="ph:brain-duotone" class="h-5 w-5 text-neutral-500" />
		<h3 class="font-semibold">LLM Provider</h3>
	</div>

	<form {...updateConfig} class="space-y-4">
		<label class="block">
			<span class="flex items-center gap-1.5 text-sm text-neutral-600">
				<Icon icon="ph:plugs-connected-duotone" class="h-4 w-4 text-neutral-400" />
				Provider
			</span>
			<select
				{...updateConfig.fields.provider.as('text')}
				class="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
			>
				<option value="openai">OpenAI</option>
				<option value="groq">Groq</option>
				<option value="ollama">Ollama</option>
				<option value="bedrock">AWS Bedrock</option>
				<option value="openrouter">OpenRouter</option>
			</select>
			{#each updateConfig.fields.provider.issues() ?? [] as issue (issue.message)}
				<p class="text-sm text-red-600">{issue.message}</p>
			{/each}
		</label>

		<label class="block">
			<span class="flex items-center gap-1.5 text-sm text-neutral-600">
				<Icon icon="ph:lock-key-duotone" class="h-4 w-4 text-neutral-400" />
				API Key
			</span>
			<input
				{...updateConfig.fields.apiKey.as('password')}
				placeholder={config?.apiKey ?? 'Enter your API key'}
				class="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
			/>
			{#each updateConfig.fields.apiKey.issues() ?? [] as issue (issue.message)}
				<p class="text-sm text-red-600">{issue.message}</p>
			{/each}
		</label>

		<label class="block">
			<span class="flex items-center gap-1.5 text-sm text-neutral-600">
				<Icon icon="ph:cube-duotone" class="h-4 w-4 text-neutral-400" />
				Model (optional)
			</span>
			<input
				{...updateConfig.fields.model.as('text')}
				placeholder="e.g., gpt-4o, llama-3.3-70b-versatile"
				class="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
			/>
		</label>

		<button
			type="submit"
			class="flex items-center gap-2 rounded-lg bg-neutral-800 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
		>
			<Icon icon="ph:floppy-disk-duotone" class="h-4 w-4" />
			Save
		</button>
	</form>

	{#if config}
		<div class="mt-4 flex items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
			<Icon icon="ph:info-duotone" class="h-4 w-4 shrink-0 text-neutral-400" />
			Current: {config.provider} &middot; Key: {config.apiKey}
			{#if config.model} &middot; Model: {config.model}{/if}
		</div>
	{/if}
</div>

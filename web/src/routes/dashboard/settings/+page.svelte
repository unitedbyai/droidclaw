<script lang="ts">
	import { getConfig, updateConfig } from '$lib/api/settings.remote';

	const config = await getConfig();
</script>

<h2 class="mb-6 text-2xl font-bold">Settings</h2>

<div class="max-w-lg rounded-lg border border-neutral-200 p-6">
	<h3 class="mb-4 font-semibold">LLM Provider</h3>

	<form {...updateConfig} class="space-y-4">
		<label class="block">
			<span class="text-sm text-neutral-600">Provider</span>
			<select
				{...updateConfig.fields.provider.as('text')}
				class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm"
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
			<span class="text-sm text-neutral-600">API Key</span>
			<input
				{...updateConfig.fields.apiKey.as('password')}
				placeholder={config?.apiKey ?? 'Enter your API key'}
				class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm"
			/>
			{#each updateConfig.fields.apiKey.issues() ?? [] as issue (issue.message)}
				<p class="text-sm text-red-600">{issue.message}</p>
			{/each}
		</label>

		<label class="block">
			<span class="text-sm text-neutral-600">Model (optional)</span>
			<input
				{...updateConfig.fields.model.as('text')}
				placeholder="e.g., gpt-4o, llama-3.3-70b-versatile"
				class="mt-1 block w-full rounded border border-neutral-300 px-3 py-2 text-sm"
			/>
		</label>

		<button type="submit" class="rounded bg-neutral-800 px-4 py-2 text-sm text-white hover:bg-neutral-700">
			Save
		</button>
	</form>

	{#if config}
		<p class="mt-4 text-sm text-neutral-500">
			Current: {config.provider} &middot; Key: {config.apiKey}
			{#if config.model} &middot; Model: {config.model}{/if}
		</p>
	{/if}
</div>

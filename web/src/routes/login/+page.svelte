<script lang="ts">
	import { login } from '$lib/api/auth.remote';
	import Icon from '@iconify/svelte';
	import { AUTH_LOGIN_SUBMIT, AUTH_SIGNUP_SUBMIT } from '$lib/analytics/events';
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50">
	<div class="w-full max-w-sm">
		<div class="mb-8 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900">
				<Icon icon="ph:robot-duotone" class="h-6 w-6 text-white" />
			</div>
			<h1 class="text-2xl font-bold">Log in to DroidClaw</h1>
			<p class="mt-1 text-sm text-neutral-500">Welcome back</p>
		</div>

		<form {...login} class="space-y-4">
			<label class="block">
				<span class="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
					<Icon icon="ph:envelope-duotone" class="h-4 w-4 text-neutral-400" />
					Email
				</span>
				<input
					{...login.fields.email.as('email')}
					class="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
				/>
				{#each login.fields.email.issues() ?? [] as issue (issue.message)}
					<p class="mt-1 text-sm text-red-600">{issue.message}</p>
				{/each}
			</label>

			<label class="block">
				<span class="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
					<Icon icon="ph:lock-duotone" class="h-4 w-4 text-neutral-400" />
					Password
				</span>
				<input
					{...login.fields.password.as('password')}
					class="mt-1 block w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none"
				/>
				{#each login.fields.password.issues() ?? [] as issue (issue.message)}
					<p class="mt-1 text-sm text-red-600">{issue.message}</p>
				{/each}
			</label>

			<button
				type="submit"
				data-umami-event={AUTH_LOGIN_SUBMIT}
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-neutral-800"
			>
				<Icon icon="ph:sign-in-duotone" class="h-4 w-4" />
				Login
			</button>
		</form>

		<p class="mt-6 text-center text-sm text-neutral-500">
			Don't have an account?
			<a href="/signup" data-umami-event={AUTH_SIGNUP_SUBMIT} data-umami-event-source="login-page" class="font-medium text-neutral-700 hover:text-neutral-900">Sign up</a>
		</p>
	</div>
</div>

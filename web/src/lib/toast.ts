import { toast as sonnerToast } from 'svelte-sonner';
import IconToast from '$lib/components/IconToast.svelte';

const toastDefaults = {
	unstyled: true,
	classes: {
		toast: 'flex items-center gap-3 bg-neutral-900 text-white px-4 py-3 rounded-xl shadow-lg min-w-[300px]',
		title: 'text-sm font-medium',
		description: 'text-xs text-neutral-400'
	}
} as const;

export const toast = {
	success(message: string, description?: string) {
		sonnerToast(message, {
			...toastDefaults,
			description,
			icon: IconToast,
			componentProps: { icon: 'line-md:confirm-circle', class: 'h-5 w-5 text-emerald-400' }
		});
	},
	error(message: string, description?: string) {
		sonnerToast(message, {
			...toastDefaults,
			description,
			icon: IconToast,
			componentProps: { icon: 'line-md:close-circle', class: 'h-5 w-5 text-red-400' }
		});
	},
	info(message: string, description?: string) {
		sonnerToast(message, {
			...toastDefaults,
			description,
			icon: IconToast,
			componentProps: { icon: 'line-md:alert-circle', class: 'h-5 w-5 text-blue-400' }
		});
	},
	warning(message: string, description?: string) {
		sonnerToast(message, {
			...toastDefaults,
			description,
			icon: IconToast,
			componentProps: { icon: 'line-md:alert', class: 'h-5 w-5 text-amber-400' }
		});
	}
};

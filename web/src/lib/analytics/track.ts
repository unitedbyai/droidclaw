/**
 * Thin wrapper around Umami's tracking API.
 * Use for programmatic event tracking (form success callbacks, etc.).
 * For click tracking on buttons/links, prefer data-umami-event attributes.
 */

declare global {
	interface Window {
		umami?: {
			track: (event: string, data?: Record<string, string | number | boolean>) => void;
		};
	}
}

export function track(event: string, data?: Record<string, string | number | boolean>) {
	if (typeof window !== 'undefined' && window.umami) {
		window.umami.track(event, data);
	}
}

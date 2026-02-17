import { object, string, pipe, minLength, optional } from 'valibot';

export const llmConfigSchema = object({
	provider: pipe(string(), minLength(1)),
	apiKey: pipe(string(), minLength(1)),
	model: optional(string())
});

/**
 * Parses a natural-language workflow description into structured
 * trigger conditions and a goal template using the user's LLM.
 */

import type { LLMConfig } from "./llm.js";
import { getLlmProvider, parseJsonResponse } from "./llm.js";

export interface ParsedWorkflow {
  name: string;
  triggerType: "notification";
  conditions: Array<{
    field: "app_package" | "title" | "text";
    matchMode: "contains" | "exact" | "regex";
    value: string;
  }>;
  goalTemplate: string;
}

const PARSER_PROMPT = `You are a workflow parser for an Android automation agent.

The user describes an automation rule in plain English. Parse it into a structured workflow.

A workflow has:
1. **name**: A short human-readable name (3-6 words).
2. **triggerType**: Always "notification" for now.
3. **conditions**: An array of matching rules for incoming notifications. Each condition has:
   - "field": one of "app_package", "title", or "text"
   - "matchMode": one of "contains", "exact", or "regex"
   - "value": the string or regex to match
4. **goalTemplate**: The goal string to send to the agent when triggered. Use {{title}}, {{text}}, {{app}} as placeholders that get filled from the notification.

Example input: "When I get a WhatsApp message saying 'where are you', reply with 'Bangalore'"
Example output:
{
  "name": "Auto-reply where are you",
  "triggerType": "notification",
  "conditions": [
    {"field": "app_package", "matchMode": "contains", "value": "whatsapp"},
    {"field": "text", "matchMode": "contains", "value": "where are you"}
  ],
  "goalTemplate": "Open the WhatsApp notification from {{title}} and reply with 'Bangalore'"
}

Example input: "Reply to all notifications that have a reply button with 'I am busy'"
Example output:
{
  "name": "Auto-reply I am busy",
  "triggerType": "notification",
  "conditions": [],
  "goalTemplate": "Open the notification '{{title}}' from {{app}} and reply with 'I am busy'"
}

Respond with ONLY a valid JSON object. No explanation.`;

export async function parseWorkflowDescription(
  description: string,
  llmConfig: LLMConfig
): Promise<ParsedWorkflow> {
  const provider = getLlmProvider(llmConfig);

  const raw = await provider.getAction(PARSER_PROMPT, description);
  const parsed = parseJsonResponse(raw);

  if (!parsed || !parsed.name || !parsed.goalTemplate) {
    throw new Error("Failed to parse workflow description into structured format");
  }

  return {
    name: parsed.name as string,
    triggerType: "notification",
    conditions: (parsed.conditions as ParsedWorkflow["conditions"]) ?? [],
    goalTemplate: parsed.goalTemplate as string,
  };
}

/**
 * Classifies user input as either an immediate goal or a workflow (automation rule).
 *
 * Uses the user's LLM to determine intent. Workflows describe recurring
 * automations ("when X happens, do Y"), goals are one-time tasks ("open WhatsApp").
 */

import type { LLMConfig } from "./llm.js";
import { getLlmProvider, parseJsonResponse } from "./llm.js";

export type InputType = "goal" | "workflow";

export interface ClassificationResult {
  type: InputType;
}

const CLASSIFIER_PROMPT = `You classify user input for an Android automation agent.

Decide if the input is:
- "goal": A one-time task to execute right now (e.g. "open WhatsApp", "search for pizza", "take a screenshot", "reply to John with hello")
- "workflow": An automation rule that should be saved and triggered later when a condition is met (e.g. "when I get a notification from WhatsApp saying where are you, reply with Bangalore", "whenever someone messages me on Telegram, auto-reply with I'm busy", "reply to all notifications that have a reply button")

Key signals for "workflow":
- Uses words like "when", "whenever", "if", "every time", "automatically", "always"
- Describes a trigger condition + a response action
- Refers to future/recurring events

Key signals for "goal":
- Describes a single task to do now
- Imperative commands ("open", "send", "search", "go to")
- No conditional/temporal trigger

Respond with ONLY: {"type": "goal"} or {"type": "workflow"}`;

export async function classifyInput(
  text: string,
  llmConfig: LLMConfig
): Promise<ClassificationResult> {
  const provider = getLlmProvider(llmConfig);

  try {
    const raw = await provider.getAction(CLASSIFIER_PROMPT, text);
    const parsed = parseJsonResponse(raw);

    if (parsed?.type === "workflow") {
      return { type: "workflow" };
    }
  } catch (err) {
    console.error(`[Classifier] Failed to classify input, defaulting to goal:`, err);
  }

  // Default to goal — safer to execute once than to accidentally create a rule
  return { type: "goal" };
}

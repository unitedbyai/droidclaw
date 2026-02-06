/**
 * LLM Provider module for Android Action Kernel.
 * Supports OpenAI, Groq, AWS Bedrock, and OpenRouter (via Vercel AI SDK).
 */

import OpenAI from "openai";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { generateText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { Config } from "./config.js";
import {
  GROQ_API_BASE_URL,
  BEDROCK_ANTHROPIC_MODELS,
  BEDROCK_META_MODELS,
} from "./constants.js";
import type { ActionDecision } from "./actions.js";

// ===========================================
// System Prompt — all 15 actions + rich element context
// ===========================================

const SYSTEM_PROMPT = `You are an Android Driver Agent. Your job is to achieve the user's goal by navigating the Android UI.

You will receive:
1. GOAL — the user's task.
2. SCREEN_CONTEXT — JSON array of interactive UI elements with coordinates, states, and hierarchy.
3. PREVIOUS_ACTIONS — your action history with outcomes (OK/FAILED).
4. SCREEN_CHANGE — what changed since your last action (or if the screen is stuck).
5. VISION_FALLBACK — present when the accessibility tree is empty (custom UI / WebView).

You must output ONLY a valid JSON object with your next action.

═══════════════════════════════════════════
AVAILABLE ACTIONS (15 total)
═══════════════════════════════════════════

Navigation:
  {"action": "tap", "coordinates": [x, y], "reason": "..."}
  {"action": "longpress", "coordinates": [x, y], "reason": "..."}
  {"action": "swipe", "direction": "up|down|left|right", "reason": "..."}
  {"action": "enter", "reason": "Press Enter/submit"}
  {"action": "back", "reason": "Navigate back"}
  {"action": "home", "reason": "Go to home screen"}

Text Input:
  {"action": "type", "text": "Hello World", "reason": "..."}
  {"action": "clear", "reason": "Clear current text field before typing"}

App Control:
  {"action": "launch", "package": "com.whatsapp", "reason": "Open WhatsApp"}
  {"action": "launch", "uri": "https://maps.google.com/?q=pizza", "reason": "Open URL"}
  {"action": "launch", "package": "com.whatsapp", "uri": "content://media/external/images/1", "extras": {"android.intent.extra.TEXT": "Check this"}, "reason": "Share image to WhatsApp"}

Data:
  {"action": "screenshot", "reason": "Capture current screen"}
  {"action": "screenshot", "filename": "order_confirmation.png", "reason": "Save proof"}
  {"action": "clipboard_get", "reason": "Read clipboard contents"}
  {"action": "clipboard_set", "text": "copied text", "reason": "Set clipboard"}

System:
  {"action": "shell", "command": "am force-stop com.app.broken", "reason": "Kill crashed app"}
  {"action": "wait", "reason": "Wait for screen to load"}
  {"action": "done", "reason": "Task is complete"}

═══════════════════════════════════════════
ELEMENT PROPERTIES YOU WILL SEE
═══════════════════════════════════════════

Each element in SCREEN_CONTEXT has:
- text: visible label or content description
- center: [x, y] coordinates to tap
- size: [width, height] in pixels
- enabled: whether the element can be interacted with (DO NOT tap disabled elements!)
- checked: checkbox/toggle state (true = ON)
- focused: whether this field currently has input focus
- selected: whether this item is currently selected (tabs, list items)
- scrollable: whether this container can be scrolled
- longClickable: supports long-press for context menu
- editable: text input field
- password: password input (don't read/log the text)
- hint: placeholder text shown when field is empty
- parent: the containing element (helps understand layout hierarchy)
- action: suggested action — "tap", "type", "longpress", "scroll", or "read"

═══════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════

1. DISABLED ELEMENTS: If "enabled": false, DO NOT tap or interact with it. Find an alternative.
2. TEXT INPUT: If "editable": true, use "clear" first if field has existing text, then "type".
3. ALREADY TYPED: Check PREVIOUS_ACTIONS. Do NOT re-type text you already entered.
4. REPETITION: Do NOT tap the same coordinates twice in a row. If it didn't work, try something else.
5. STUCK: If SCREEN_CHANGE says "NOT changed", your last action had no effect. Change strategy.
6. APP LAUNCH: Use "launch" to directly open apps instead of hunting for icons on the home screen.
7. SCREENSHOTS: Use "screenshot" to capture proof of completed tasks (order confirmations, etc).
8. LONG PRESS: Use "longpress" when you see "longClickable": true (context menus, copy/paste, etc).
9. SCROLLING: If the item you need isn't visible, "swipe" up/down to scroll and find it.
10. MULTI-APP: To switch apps, use "home" then "launch" the next app. Or use "back" to return.
11. PASSWORDS: Never log or output the text of password fields.
12. DONE: Say "done" as soon as the goal is achieved. Don't keep acting after success.
13. SEARCH: After typing in a search field, use "enter" to submit the search.
14. SHARE: To send files/images between apps, use "launch" with uri + extras for Android intents.
15. CLEANUP: If a popup/ad appears, dismiss it with "back" or tap the close button, then continue.`;

// ===========================================
// Provider Interface
// ===========================================

interface ActionHistoryEntry {
  action?: string;
  reason?: string;
  text?: string;
  coordinates?: [number, number];
  package?: string;
  uri?: string;
}

export interface LLMProvider {
  getDecision(
    goal: string,
    screenContext: string,
    actionHistory: ActionHistoryEntry[]
  ): Promise<ActionDecision>;
}

// ===========================================
// OpenAI / Groq Provider
// ===========================================

class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor() {
    if (Config.LLM_PROVIDER === "groq") {
      this.client = new OpenAI({
        apiKey: Config.GROQ_API_KEY,
        baseURL: GROQ_API_BASE_URL,
      });
      this.model = Config.GROQ_MODEL;
    } else {
      this.client = new OpenAI({ apiKey: Config.OPENAI_API_KEY });
      this.model = Config.OPENAI_MODEL;
    }
  }

  async getDecision(
    goal: string,
    screenContext: string,
    _actionHistory: ActionHistoryEntry[]
  ): Promise<ActionDecision> {
    // screenContext now includes history, diff, and vision context from kernel
    const userContent = `GOAL: ${goal}\n\nSCREEN_CONTEXT:\n${screenContext}`;

    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    });

    return JSON.parse(response.choices[0].message.content ?? "{}");
  }
}

// ===========================================
// OpenRouter Provider (Vercel AI SDK)
// ===========================================

class OpenRouterProvider implements LLMProvider {
  private openrouter: ReturnType<typeof createOpenRouter>;
  private model: string;

  constructor() {
    this.openrouter = createOpenRouter({
      apiKey: Config.OPENROUTER_API_KEY,
    });
    this.model = Config.OPENROUTER_MODEL;
  }

  async getDecision(
    goal: string,
    screenContext: string,
    _actionHistory: ActionHistoryEntry[]
  ): Promise<ActionDecision> {
    const userContent = `GOAL: ${goal}\n\nSCREEN_CONTEXT:\n${screenContext}`;

    const result = await generateText({
      model: this.openrouter.chat(this.model),
      system: SYSTEM_PROMPT,
      prompt: userContent + "\n\nRespond with ONLY a valid JSON object.",
    });

    return parseJsonResponse(result.text);
  }
}

// ===========================================
// AWS Bedrock Provider
// ===========================================

class BedrockProvider implements LLMProvider {
  private client: BedrockRuntimeClient;
  private model: string;

  constructor() {
    this.client = new BedrockRuntimeClient({ region: Config.AWS_REGION });
    this.model = Config.BEDROCK_MODEL;
  }

  async getDecision(
    goal: string,
    screenContext: string,
    _actionHistory: ActionHistoryEntry[]
  ): Promise<ActionDecision> {
    const userContent = `GOAL: ${goal}\n\nSCREEN_CONTEXT:\n${screenContext}`;
    const requestBody = this.buildRequest(userContent);

    const command = new InvokeModelCommand({
      modelId: this.model,
      body: new TextEncoder().encode(requestBody),
      contentType: "application/json",
      accept: "application/json",
    });

    const response = await this.client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const resultText = this.extractResponse(responseBody);

    return parseJsonResponse(resultText);
  }

  private isAnthropicModel(): boolean {
    return BEDROCK_ANTHROPIC_MODELS.some((id) => this.model.includes(id));
  }

  private isMetaModel(): boolean {
    return BEDROCK_META_MODELS.some((id) =>
      this.model.toLowerCase().includes(id)
    );
  }

  private buildRequest(userContent: string): string {
    if (this.isAnthropicModel()) {
      return JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content:
              userContent + "\n\nRespond with ONLY a valid JSON object.",
          },
        ],
      });
    }

    if (this.isMetaModel()) {
      return JSON.stringify({
        prompt: `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${SYSTEM_PROMPT}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${userContent}\n\nRespond with ONLY a valid JSON object, no other text.<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`,
        max_gen_len: 512,
        temperature: 0.1,
      });
    }

    return JSON.stringify({
      inputText: `${SYSTEM_PROMPT}\n\n${userContent}\n\nRespond with ONLY a valid JSON object.`,
      textGenerationConfig: {
        maxTokenCount: 512,
        temperature: 0.1,
      },
    });
  }

  private extractResponse(responseBody: Record<string, any>): string {
    if (this.isAnthropicModel()) {
      return responseBody.content[0].text;
    }
    if (this.isMetaModel()) {
      return responseBody.generation ?? "";
    }
    return responseBody.results[0].outputText;
  }
}

// ===========================================
// Shared JSON Parsing
// ===========================================

function parseJsonResponse(text: string): ActionDecision {
  try {
    return JSON.parse(text);
  } catch {
    // Try to extract JSON from markdown code blocks or mixed text
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    console.log(`Warning: Could not parse LLM response: ${text.slice(0, 200)}`);
    return { action: "wait", reason: "Failed to parse response, waiting" };
  }
}

// ===========================================
// Factory
// ===========================================

export function getLlmProvider(): LLMProvider {
  if (Config.LLM_PROVIDER === "bedrock") {
    return new BedrockProvider();
  }
  if (Config.LLM_PROVIDER === "openrouter") {
    return new OpenRouterProvider();
  }
  return new OpenAIProvider();
}

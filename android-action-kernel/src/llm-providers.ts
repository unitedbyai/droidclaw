/**
 * LLM Provider module for Android Action Kernel.
 * Supports OpenAI, Groq, AWS Bedrock, and OpenRouter (via Vercel AI SDK).
 *
 * Phase 3: Real multimodal vision (image content parts)
 * Phase 4A: Multi-turn conversation memory (ChatMessage[] interface)
 * Phase 5: Streaming responses (getDecisionStream)
 */

import OpenAI from "openai";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { generateText, streamText } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";

import { Config } from "./config.js";
import {
  GROQ_API_BASE_URL,
  BEDROCK_ANTHROPIC_MODELS,
  BEDROCK_META_MODELS,
} from "./constants.js";
import type { ActionDecision } from "./actions.js";

// ===========================================
// System Prompt — all 15 actions + planning
// ===========================================

export const SYSTEM_PROMPT = `You are an Android Driver Agent. Your job is to achieve the user's goal by navigating the Android UI.

You will receive:
1. GOAL — the user's task.
2. FOREGROUND_APP — the currently active app package and activity.
3. SCREEN_CONTEXT — JSON array of interactive UI elements with coordinates and states.
4. SCREENSHOT — an image of the current screen (when available).
5. SCREEN_CHANGE — what changed since your last action (or if the screen is stuck).
6. VISION_FALLBACK — present when the accessibility tree is empty (custom UI / WebView).

Previous conversation turns contain your earlier observations and actions (multi-turn memory).

You must output ONLY a valid JSON object with your next action.

═══════════════════════════════════════════
THINKING & PLANNING
═══════════════════════════════════════════

Before each action, include a "think" field with your reasoning about the current state and what to do next.

Optionally include:
- "plan": an array of 3-5 high-level steps to achieve the goal
- "planProgress": a brief note on which plan step you're currently on

Example:
{"think": "I see the Settings app is open. I need to scroll down to find Display settings.", "plan": ["Open Settings", "Navigate to Display", "Change theme to dark", "Verify change"], "planProgress": "Step 2: navigating to Display", "action": "swipe", "direction": "up", "reason": "Scroll down to find Display option"}

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
- action: suggested action — "tap", "type", "longpress", "scroll", or "read"
- enabled: false (only shown when disabled — DO NOT tap disabled elements!)
- checked: true (only shown for ON checkboxes/toggles)
- focused: true (only shown when field has input focus)
- hint: placeholder text (only shown when present)
- editable: true (only shown for text input fields)
- scrollable: true (only shown for scrollable containers)

═══════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════

1. DISABLED ELEMENTS: If "enabled": false, DO NOT tap or interact with it. Find an alternative.
2. TEXT INPUT: If "editable": true, use "clear" first if field has existing text, then "type".
3. ALREADY TYPED: Check your previous actions. Do NOT re-type text you already entered.
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
// Chat Message Types (Phase 4A)
// ===========================================

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; base64: string; mimeType: "image/png" | "image/jpeg" };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

// ===========================================
// Provider Interface
// ===========================================

export interface LLMProvider {
  readonly capabilities: {
    supportsImages: boolean;
    supportsStreaming: boolean;
  };
  getDecision(messages: ChatMessage[]): Promise<ActionDecision>;
  getDecisionStream?(messages: ChatMessage[]): AsyncIterable<string>;
}

// ===========================================
// Message Trimming (Phase 4A)
// ===========================================

/**
 * Trims conversation messages to keep within history limit.
 * Always keeps the system message. Drops oldest user/assistant pairs.
 */
export function trimMessages(
  messages: ChatMessage[],
  maxHistorySteps: number
): ChatMessage[] {
  if (messages.length === 0) return messages;

  // System message is always first
  const system = messages[0].role === "system" ? messages[0] : null;
  const rest = system ? messages.slice(1) : messages;

  // Count user/assistant pairs (each step = 1 user + 1 assistant)
  const maxMessages = maxHistorySteps * 2;
  if (rest.length <= maxMessages) {
    return messages;
  }

  const dropped = rest.length - maxMessages;
  const stepsDropped = Math.floor(dropped / 2);
  const trimmed = rest.slice(dropped);

  // Insert a summary note
  const summary: ChatMessage = {
    role: "user",
    content: `[${stepsDropped} earlier steps omitted]`,
  };

  return system ? [system, summary, ...trimmed] : [summary, ...trimmed];
}

// ===========================================
// OpenAI / Groq Provider
// ===========================================

class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;
  readonly capabilities: { supportsImages: boolean; supportsStreaming: boolean };

  constructor() {
    if (Config.LLM_PROVIDER === "groq") {
      this.client = new OpenAI({
        apiKey: Config.GROQ_API_KEY,
        baseURL: GROQ_API_BASE_URL,
      });
      this.model = Config.GROQ_MODEL;
      this.capabilities = { supportsImages: false, supportsStreaming: true };
    } else {
      this.client = new OpenAI({ apiKey: Config.OPENAI_API_KEY });
      this.model = Config.OPENAI_MODEL;
      this.capabilities = { supportsImages: true, supportsStreaming: true };
    }
  }

  private toOpenAIMessages(
    messages: ChatMessage[]
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content } as OpenAI.ChatCompletionMessageParam;
      }
      // Convert ContentPart[] to OpenAI format
      const parts: OpenAI.ChatCompletionContentPart[] = msg.content.map(
        (part) => {
          if (part.type === "text") {
            return { type: "text" as const, text: part.text };
          }
          // Image — only for OpenAI (Groq skips images)
          if (this.capabilities.supportsImages) {
            return {
              type: "image_url" as const,
              image_url: {
                url: `data:${part.mimeType};base64,${part.base64}`,
                detail: "low" as const,
              },
            };
          }
          // Groq: convert image to text placeholder
          return { type: "text" as const, text: "[Screenshot attached]" };
        }
      );
      return {
        role: msg.role,
        content: parts,
      } as OpenAI.ChatCompletionMessageParam;
    });
  }

  async getDecision(messages: ChatMessage[]): Promise<ActionDecision> {
    const openaiMessages = this.toOpenAIMessages(messages);
    const response = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: openaiMessages,
    });
    return parseJsonResponse(response.choices[0].message.content ?? "{}");
  }

  async *getDecisionStream(messages: ChatMessage[]): AsyncIterable<string> {
    const openaiMessages = this.toOpenAIMessages(messages);
    const stream = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: "json_object" },
      messages: openaiMessages,
      stream: true,
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) yield content;
    }
  }
}

// ===========================================
// OpenRouter Provider (Vercel AI SDK)
// ===========================================

class OpenRouterProvider implements LLMProvider {
  private openrouter: ReturnType<typeof createOpenRouter>;
  private model: string;
  readonly capabilities = { supportsImages: true, supportsStreaming: true };

  constructor() {
    this.openrouter = createOpenRouter({
      apiKey: Config.OPENROUTER_API_KEY,
    });
    this.model = Config.OPENROUTER_MODEL;
  }

  private toVercelMessages(messages: ChatMessage[]) {
    // Vercel AI SDK uses a similar format but we need to convert images
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const converted = nonSystem.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role as "user" | "assistant", content: msg.content };
      }
      const parts = msg.content.map((part) => {
        if (part.type === "text") {
          return { type: "text" as const, text: part.text };
        }
        return {
          type: "image" as const,
          image: `data:${part.mimeType};base64,${part.base64}`,
        };
      });
      return { role: msg.role as "user" | "assistant", content: parts };
    });

    return {
      system: typeof systemMsg?.content === "string" ? systemMsg.content : "",
      messages: converted,
    };
  }

  async getDecision(messages: ChatMessage[]): Promise<ActionDecision> {
    const { system, messages: converted } = this.toVercelMessages(messages);
    const result = await generateText({
      model: this.openrouter.chat(this.model),
      system,
      messages: converted as any,
    });
    return parseJsonResponse(result.text);
  }

  async *getDecisionStream(messages: ChatMessage[]): AsyncIterable<string> {
    const { system, messages: converted } = this.toVercelMessages(messages);
    const result = streamText({
      model: this.openrouter.chat(this.model),
      system,
      messages: converted as any,
    });
    for await (const chunk of result.textStream) {
      yield chunk;
    }
  }
}

// ===========================================
// AWS Bedrock Provider
// ===========================================

class BedrockProvider implements LLMProvider {
  private client: BedrockRuntimeClient;
  private model: string;
  readonly capabilities: { supportsImages: boolean; supportsStreaming: boolean };

  constructor() {
    this.client = new BedrockRuntimeClient({ region: Config.AWS_REGION });
    this.model = Config.BEDROCK_MODEL;
    // Only Anthropic models on Bedrock support images
    this.capabilities = {
      supportsImages: this.isAnthropicModel(),
      supportsStreaming: true,
    };
  }

  private isAnthropicModel(): boolean {
    return BEDROCK_ANTHROPIC_MODELS.some((id) => this.model.includes(id));
  }

  private isMetaModel(): boolean {
    return BEDROCK_META_MODELS.some((id) =>
      this.model.toLowerCase().includes(id)
    );
  }

  private buildAnthropicMessages(messages: ChatMessage[]) {
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const converted = nonSystem.map((msg) => {
      if (typeof msg.content === "string") {
        return { role: msg.role, content: msg.content };
      }
      const parts = msg.content.map((part) => {
        if (part.type === "text") {
          return { type: "text", text: part.text };
        }
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: part.mimeType,
            data: part.base64,
          },
        };
      });
      return { role: msg.role, content: parts };
    });

    return {
      system: typeof systemMsg?.content === "string" ? systemMsg.content : "",
      messages: converted,
    };
  }

  private buildRequest(messages: ChatMessage[]): string {
    if (this.isAnthropicModel()) {
      const { system, messages: converted } = this.buildAnthropicMessages(messages);
      return JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 1024,
        system,
        messages: converted,
      });
    }

    // For Meta/other models, flatten to single prompt (no multi-turn / image support)
    const systemContent = messages.find((m) => m.role === "system");
    const userMessages = messages
      .filter((m) => m.role === "user")
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : m.content
              .filter((p) => p.type === "text")
              .map((p) => (p as { type: "text"; text: string }).text)
              .join("\n")
      );
    const lastUserContent = userMessages[userMessages.length - 1] ?? "";
    const sysText =
      typeof systemContent?.content === "string" ? systemContent.content : "";

    if (this.isMetaModel()) {
      return JSON.stringify({
        prompt: `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${sysText}<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${lastUserContent}\n\nRespond with ONLY a valid JSON object, no other text.<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`,
        max_gen_len: 512,
        temperature: 0.1,
      });
    }

    return JSON.stringify({
      inputText: `${sysText}\n\n${lastUserContent}\n\nRespond with ONLY a valid JSON object.`,
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

  async getDecision(messages: ChatMessage[]): Promise<ActionDecision> {
    const requestBody = this.buildRequest(messages);
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

  async *getDecisionStream(messages: ChatMessage[]): AsyncIterable<string> {
    if (!this.isAnthropicModel()) {
      // Fallback: non-streaming for non-Anthropic models
      const decision = await this.getDecision(messages);
      yield JSON.stringify(decision);
      return;
    }

    const { system, messages: converted } = this.buildAnthropicMessages(messages);
    const requestBody = JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: 1024,
      system,
      messages: converted,
    });

    const command = new InvokeModelWithResponseStreamCommand({
      modelId: this.model,
      body: new TextEncoder().encode(requestBody),
      contentType: "application/json",
    });

    const response = await this.client.send(command);
    if (response.body) {
      for await (const event of response.body) {
        if (event.chunk?.bytes) {
          const data = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
          if (data.type === "content_block_delta" && data.delta?.text) {
            yield data.delta.text;
          }
        }
      }
    }
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

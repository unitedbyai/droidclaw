/**
 * LLM Provider module for DroidClaw.
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
import { generateText, streamText, generateObject, streamObject } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

import { Config } from "./config.js";
import {
  GROQ_API_BASE_URL,
  BEDROCK_ANTHROPIC_MODELS,
  BEDROCK_META_MODELS,
} from "./constants.js";
import { sanitizeCoordinates, type ActionDecision } from "./actions.js";

// ===========================================
// System Prompt — all 22 actions + planning
// ===========================================

export const SYSTEM_PROMPT = `You are an Android Driver Agent. Your job is to achieve the user's goal by navigating the Android UI.

You will receive:
1. GOAL — the user's task.
2. FOREGROUND_APP — the currently active app package and activity.
3. LAST_ACTION_RESULT — the outcome of your previous action (success/failure and details).
4. SCREEN_CONTEXT — JSON array of interactive UI elements with coordinates and states.
5. SCREENSHOT — an image of the current screen (when available).
6. SCREEN_CHANGE — what changed since your last action (or if the screen is stuck).
7. VISION_FALLBACK — present when the accessibility tree is empty (custom UI / WebView).

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
AVAILABLE ACTIONS (22 total)
═══════════════════════════════════════════

Navigation (coordinates MUST be a JSON array of TWO separate integers [x, y] — never concatenate them):
  {"action": "tap", "coordinates": [540, 1200], "reason": "..."}
  {"action": "longpress", "coordinates": [540, 1200], "reason": "..."}
  {"action": "scroll", "direction": "up|down|left|right", "reason": "Scroll to see more content (down=below, up=above)"}
  {"action": "enter", "reason": "Press Enter/submit"}
  {"action": "back", "reason": "Navigate back"}
  {"action": "home", "reason": "Go to home screen"}

Text Input (ALWAYS include coordinates to focus the correct field before typing):
  {"action": "type", "coordinates": [540, 648], "text": "Hello World", "reason": "..."}
  {"action": "clear", "reason": "Clear current text field before typing"}

App Control:
  {"action": "launch", "package": "com.whatsapp", "reason": "Open WhatsApp"}
  {"action": "launch", "uri": "https://maps.google.com/?q=pizza", "reason": "Open URL"}
  {"action": "launch", "package": "com.whatsapp", "uri": "content://media/external/images/1", "extras": {"android.intent.extra.TEXT": "Check this"}, "reason": "Share image to WhatsApp"}
  {"action": "open_url", "url": "https://example.com", "reason": "Open URL in browser"}
  {"action": "switch_app", "package": "com.whatsapp", "reason": "Switch to WhatsApp"}
  {"action": "open_settings", "setting": "wifi|bluetooth|display|sound|battery|location|apps|date|accessibility|developer", "reason": "Open settings screen"}

Data:
  {"action": "clipboard_get", "reason": "Read clipboard contents"}
  {"action": "clipboard_set", "text": "copied text", "reason": "Set clipboard"}
  {"action": "paste", "coordinates": [540, 804], "reason": "Paste clipboard into focused field"}

Device & Files:
  {"action": "notifications", "reason": "Read notification bar content"}
  {"action": "pull_file", "path": "/sdcard/Download/file.pdf", "reason": "Pull file from device"}
  {"action": "push_file", "source": "./file.pdf", "dest": "/sdcard/Download/file.pdf", "reason": "Push file to device"}
  {"action": "keyevent", "code": 187, "reason": "Send keycode (187=recent apps, 26=power, etc.)"}

System:
  {"action": "shell", "command": "am force-stop com.app.broken", "reason": "Kill crashed app"}
  {"action": "wait", "reason": "Wait for screen to load"}
  {"action": "done", "reason": "Task is complete"}

Multi-Step Actions (PREFER these over basic actions when applicable):
  {"action": "read_screen", "reason": "Scroll through entire page, collect ALL text, copy to clipboard"}
  {"action": "submit_message", "reason": "Find and tap Send button, wait for response"}
  {"action": "copy_visible_text", "reason": "Copy all visible text to clipboard"}
  {"action": "copy_visible_text", "query": "search term", "reason": "Copy matching text to clipboard"}
  {"action": "wait_for_content", "reason": "Wait for new content to appear"}
  {"action": "find_and_tap", "query": "Button Label", "reason": "Find element by text and tap it"}
  {"action": "compose_email", "query": "recipient@email.com", "reason": "Fill email To+Body, pastes clipboard into body"}
  {"action": "compose_email", "query": "recipient@email.com", "text": "body", "reason": "Fill email with specific body"}
  NOTE: compose_email REQUIRES "query" = recipient email. "text" is optional body (clipboard used if empty).

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
2. TEXT INPUT: ALWAYS include "coordinates" with "type" to focus the correct field. Without coordinates, text goes into whatever field was last focused — which may be WRONG. If "editable": true, use "clear" first if field has existing text, then "type".
3. ALREADY TYPED: Check your previous actions. Do NOT re-type text you already entered.
4. REPETITION: Do NOT tap the same coordinates twice in a row. If it didn't work, try something else.
5. STUCK: If SCREEN_CHANGE says "NOT changed", your last action had no effect. Change strategy.
6. APP LAUNCH: Use "launch" to directly open apps instead of hunting for icons on the home screen.
7. READ PAGES: Use "read_screen" to collect all text from a page (search results, articles, feeds). It scrolls automatically and copies everything to clipboard.
8. LONG PRESS: Use "longpress" when you see "longClickable": true (context menus, copy/paste, etc).
9. SCROLLING: If the item you need isn't visible, use "scroll" with direction "down" to see more below, or "up" for above.
10. MULTI-APP: Use "switch_app" with the package name to switch directly between apps. Or use "home" then "launch". Use "back" to return within the same app.
11. PASSWORDS: Never log or output the text of password fields.
12. DONE: Say "done" as soon as the goal is achieved. Don't keep acting after success.
13. SUBMIT IN CHAT APPS: Use "submit_message" action instead of "enter" in chat apps. It finds and taps the Send button, waits for a response, and reports new content. Only use "enter" in search bars or web forms.
14. SHARE: To send files/images between apps, use "launch" with uri + extras for Android intents.
15. CLEANUP: If a popup/ad appears, dismiss it with "back" or tap the close button, then continue.
16. COPY-PASTE: PREFERRED: Use "copy_visible_text" action to copy text to clipboard programmatically — this bypasses unreliable UI Copy buttons entirely. Then switch apps and "paste".
    ALTERNATIVE: Use "clipboard_set" with the text you see in SCREEN_CONTEXT, then switch apps and "paste".
    FALLBACK: Just "type" the text directly into the target app field.
    NEVER type a vague description — always use the actual text content.
17. COORDINATES: ALWAYS use coordinates from SCREEN_CONTEXT elements (the "center" field). NEVER estimate or guess coordinates from screenshots — they are inaccurate. Screenshots help you understand the layout; SCREEN_CONTEXT provides the correct tap targets.
18. BACK IS DESTRUCTIVE: NEVER use "back" to leave an app while you have a task in progress within it. You will LOSE all progress (typed text, loading responses, navigation state). Try all other in-app approaches first. Only use "back" after 5+ failed attempts within the app.
19. LEARN FROM HISTORY: Before choosing an action, check your earlier turns. If "enter" failed to submit a query before, do NOT try "enter" again — find and tap the Send button. If specific coordinates didn't work, try different ones. Never repeat a strategy that already failed in this session.
20. EMAIL COMPOSE: ALWAYS use "compose_email" action when filling email fields. It fills To, Subject, and Body in the correct order. Pass the recipient email in "query" and body text in "text" (or it pastes from clipboard). NEVER manually type/paste into email fields — you WILL put it in the wrong field.

═══════════════════════════════════════════
ADAPTIVE PROBLEM-SOLVING
═══════════════════════════════════════════

NEVER REPEAT A FAILING ACTION more than once. If an action doesn't produce the expected result after 1 attempt, STOP and try a completely different approach.

SILENT SUCCESSES: Some actions succeed WITHOUT changing the screen:
- Tapping "Copy", "Share", "Like", or "Bookmark" buttons often works silently.
- If you tapped a Copy button and the screen didn't change, it likely WORKED. Move on to the next step instead of retrying.

SCREEN_CONTEXT IS YOUR DATA: The text in SCREEN_CONTEXT elements is data you already have. You can use it directly in:
- "clipboard_set" — to set clipboard contents programmatically (more reliable than UI copy)
- "type" — to enter text directly into any field
You do NOT need to "copy" text via UI — you already have it from SCREEN_CONTEXT.

GOAL-ORIENTED THINKING: Focus on WHAT you need to accomplish, not on rigidly following planned steps. If a step fails, ask: "What was the PURPOSE of this step?" and find another way.
- Goal says "copy and send as email"? If Copy fails, use clipboard_set with SCREEN_CONTEXT text, or type it directly in the email.
- Goal says "search for X"? If enter doesn't submit, look for and tap the send/search button.
- Goal says "open app X"? Use "launch" with package name instead of hunting for icons.

SMART DECISION PRIORITIES: When multiple approaches can achieve the same result, prefer:
1. Programmatic actions (clipboard_set, launch, shell) — most reliable, no UI dependency.
2. Direct input (type, paste, enter) — reliable when field is focused.
3. UI button interactions (tap, longpress) — LEAST reliable, depends on correct coordinates.
Before choosing an action, ask: "Is there a simpler, more direct way to do this?"

PATIENCE WITH LOADING: AI chatbots (ChatGPT, Gemini, Claude) take 5-15 seconds to generate responses. After submitting a query, use "wait" 2-3 times before assuming it failed. Do NOT start scrolling or navigating away prematurely.

ESCAPE STUCK LOOPS — when stuck, try in this priority order:
1. The action may have already succeeded silently — MOVE ON to the next task step.
2. Use programmatic alternatives (clipboard_set, type, shell, launch with URI).
3. Try a completely different UI element or interaction method.
4. Navigate away (back, home) ONLY as an absolute last resort — this loses progress.`;

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

/** Zod schema for structured LLM output — guarantees valid JSON */
const actionDecisionSchema = z.object({
  think: z.string().optional().describe("Your reasoning about the current screen state and what to do next"),
  plan: z.array(z.string()).optional().describe("3-5 high-level steps to achieve the goal"),
  planProgress: z.string().optional().describe("Which plan step you are currently on"),
  action: z.string().describe("The action to take: tap, type, scroll, enter, back, home, wait, done, longpress, launch, clear, clipboard_get, clipboard_set, paste, shell, open_url, switch_app, notifications, pull_file, push_file, keyevent, open_settings, read_screen, submit_message, copy_visible_text, wait_for_content, find_and_tap, compose_email"),
  coordinates: z.tuple([z.number(), z.number()]).optional().describe("Target field as [x, y] — used by tap, longpress, type, and paste"),
  text: z.string().optional().describe("Text to type, clipboard text, or email body for compose_email"),
  direction: z.string().optional().describe("Scroll direction: up, down, left, right"),
  reason: z.string().optional().describe("Why you chose this action"),
  package: z.string().optional().describe("App package name for launch action"),
  activity: z.string().optional().describe("Activity name for launch action"),
  uri: z.string().optional().describe("URI for launch action"),
  extras: z.record(z.string(), z.string()).optional().describe("Intent extras for launch action"),
  command: z.string().optional().describe("Shell command to run"),
  filename: z.string().optional().describe("Screenshot filename"),
  query: z.string().optional().describe("Email address for compose_email (REQUIRED), search term for find_and_tap (REQUIRED), or filter for copy_visible_text"),
  url: z.string().optional().describe("URL to open for open_url action"),
  path: z.string().optional().describe("Device file path for pull_file action"),
  source: z.string().optional().describe("Local file path for push_file action"),
  dest: z.string().optional().describe("Device destination path for push_file action"),
  code: z.number().optional().describe("Android keycode number for keyevent action"),
  setting: z.string().optional().describe("Setting name for open_settings: wifi, bluetooth, display, sound, battery, location, apps, date, accessibility, developer"),
});

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
    const { object } = await generateObject({
      model: this.openrouter.chat(this.model),
      schema: actionDecisionSchema,
      system,
      messages: converted as any,
    });
    // Sanitize coordinates from structured output
    const decision = object as ActionDecision;
    decision.coordinates = sanitizeCoordinates(decision.coordinates);
    return decision;
  }

  async *getDecisionStream(messages: ChatMessage[]): AsyncIterable<string> {
    const { system, messages: converted } = this.toVercelMessages(messages);
    const { partialObjectStream } = streamObject({
      model: this.openrouter.chat(this.model),
      schema: actionDecisionSchema,
      system,
      messages: converted as any,
    });
    // Accumulate partial objects and yield the final complete one as JSON
    let lastObject: any = {};
    for await (const partial of partialObjectStream) {
      lastObject = partial;
      // Yield a dot for progress indication (streaming UI feedback)
      yield ".";
    }
    yield JSON.stringify(lastObject);
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

/**
 * Sanitizes raw LLM text so it can be parsed as JSON.
 * LLMs often put literal newlines inside JSON string values which breaks JSON.parse().
 */
export function sanitizeJsonText(raw: string): string {
  return raw.replace(/\n/g, " ").replace(/\r/g, " ");
}

export function parseJsonResponse(text: string): ActionDecision {
  let decision: ActionDecision | null = null;
  try {
    decision = JSON.parse(text);
  } catch {
    try {
      decision = JSON.parse(sanitizeJsonText(text));
    } catch {
      // Try to extract JSON from markdown code blocks or mixed text
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          decision = JSON.parse(sanitizeJsonText(match[0]));
        } catch {
          // fall through
        }
      }
    }
  }
  if (!decision) {
    console.log(`Warning: Could not parse LLM response: ${text.slice(0, 200)}`);
    return { action: "wait", reason: "Failed to parse response, waiting" };
  }
  decision.coordinates = sanitizeCoordinates(decision.coordinates);
  return decision;
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

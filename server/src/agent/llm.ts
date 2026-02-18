/**
 * LLM provider abstraction for the DroidClaw server agent loop.
 *
 * For v1, implements an OpenAI-compatible provider that works with
 * OpenAI, Groq, and OpenRouter (all use the same /chat/completions API).
 *
 * The SYSTEM_PROMPT is adapted from the CLI src/llm-providers.ts,
 * with ADB-specific references removed since the phone handles
 * actions directly via the WebSocket companion app.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface LLMConfig {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export interface LLMProvider {
  getAction(
    systemPrompt: string,
    userPrompt: string,
    imageBase64?: string,
    signal?: AbortSignal
  ): Promise<string>;
}

// ─── System Prompt ──────────────────────────────────────────────

/**
 * Returns the system prompt that defines all 22+ actions and rules
 * for the Android driver agent. Adapted from the CLI SYSTEM_PROMPT
 * with ADB references removed (phone companion handles execution).
 */
export function getSystemPrompt(): string {
  return `You are an Android Driver Agent. Your job is to achieve the user's goal by navigating the Android UI.

You will receive:
1. GOAL -- the user's task.
2. FOREGROUND_APP -- the currently active app package and activity.
3. LAST_ACTION_RESULT -- the outcome of your previous action (success/failure and details).
4. SCREEN_CONTEXT -- JSON array of interactive UI elements with coordinates and states.
5. SCREENSHOT -- an image of the current screen (when available).
6. SCREEN_CHANGE -- what changed since your last action (or if the screen is stuck).
7. VISION_FALLBACK -- present when the accessibility tree is empty (custom UI / WebView).

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
AVAILABLE ACTIONS (23 total)
═══════════════════════════════════════════

Navigation (coordinates MUST be a JSON array of TWO separate integers [x, y] -- never concatenate them):
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
  {"action": "open_settings", "setting": "wifi|bluetooth|display|sound|battery|location|apps|date|accessibility|developer|dnd|network|storage|security", "reason": "Open settings screen"}

Data:
  {"action": "clipboard_get", "reason": "Read clipboard contents"}
  {"action": "clipboard_set", "text": "copied text", "reason": "Set clipboard"}
  {"action": "paste", "coordinates": [540, 804], "reason": "Paste clipboard into focused field"}

Device:
  {"action": "notifications", "reason": "Read notification bar content"}
  {"action": "keyevent", "code": 187, "reason": "Send keycode (187=recent apps, 26=power, etc.)"}

Intent (fire Android intents directly — skips UI navigation, no screen parsing needed):
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "https://wa.me/919876543210?text=Hello", "reason": "WhatsApp message"}
  {"action": "intent", "intentAction": "android.intent.action.SENDTO", "uri": "sms:+1234567890", "extras": {"sms_body": "Running late"}, "reason": "SMS"}
  {"action": "intent", "intentAction": "android.intent.action.CALL", "uri": "tel:+1234567890", "reason": "Phone call"}
  {"action": "intent", "intentAction": "android.intent.action.SENDTO", "uri": "mailto:user@example.com", "extras": {"android.intent.extra.SUBJECT": "Hi"}, "reason": "Email"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "upi://pay?pa=merchant@upi&pn=Shop&am=500&cu=INR", "reason": "UPI payment"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "google.navigation:q=Airport&mode=d", "reason": "Turn-by-turn navigation"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "geo:0,0?q=coffee+near+me", "reason": "Search nearby on Maps"}
  {"action": "intent", "intentAction": "android.intent.action.SET_ALARM", "extras": {"android.intent.extra.alarm.HOUR": "6", "android.intent.extra.alarm.MINUTES": "30", "android.intent.extra.alarm.MESSAGE": "Wake up"}, "reason": "Set alarm"}
  {"action": "intent", "intentAction": "android.intent.action.SET_TIMER", "extras": {"android.intent.extra.alarm.LENGTH": "300", "android.intent.extra.alarm.MESSAGE": "Break over"}, "reason": "Start timer"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "spotify:track:TRACK_ID", "reason": "Play Spotify track"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "vnd.youtube:VIDEO_ID", "reason": "Play YouTube video"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "instagram://user?username=USERNAME", "reason": "Open Instagram profile"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "twitter://user?screen_name=USERNAME", "reason": "Open Twitter/X profile"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "zoomus://zoom.us/join?confno=MEETING_ID", "reason": "Join Zoom meeting"}
  {"action": "intent", "intentAction": "android.intent.action.INSERT", "intentType": "vnd.android.cursor.dir/event", "extras": {"title": "Meeting", "beginTime": "1700000000000"}, "reason": "Add calendar event"}
  {"action": "intent", "intentAction": "android.intent.action.SEND", "intentType": "text/plain", "extras": {"android.intent.extra.TEXT": "Check this out"}, "reason": "Share text via share sheet"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "uber://?action=setPickup&pickup=my_location&dropoff[formatted_address]=Office", "reason": "Uber ride"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "phonepe://pay?pa=someone@ybl&pn=Name&am=200", "reason": "PhonePe payment"}

System:
  {"action": "wait", "reason": "Wait for screen to load"}
  {"action": "done", "reason": "Task is complete"}

Multi-Step Actions (PREFER these over basic actions when applicable):
  {"action": "read_screen", "reason": "Scroll through entire page, collect ALL text, copy to clipboard"}
  {"action": "submit_message", "reason": "Find and tap Send button, wait for response"}
  {"action": "copy_visible_text", "reason": "Copy all visible text to clipboard"}
  {"action": "copy_visible_text", "query": "search term", "reason": "Copy matching text to clipboard"}
  {"action": "wait_for_content", "reason": "Wait for new content to appear"}
  {"action": "find_and_tap", "query": "Settings", "reason": "Scroll to find a VISIBLE button/label and tap it"}
  {"action": "compose_email", "query": "recipient@email.com", "reason": "Fill email To+Body, pastes clipboard into body"}
  {"action": "compose_email", "query": "recipient@email.com", "text": "body", "reason": "Fill email with specific body"}
  NOTE: compose_email REQUIRES "query" = recipient email. "text" is optional body (clipboard used if empty).
  NOTE: find_and_tap is ONLY for tapping elements that ALREADY EXIST on screen (buttons, menu items, labels). It scrolls to find them. To INPUT text into a search bar or text field, use "type" action instead — NEVER use find_and_tap for typing.

═══════════════════════════════════════════
ELEMENT PROPERTIES YOU WILL SEE
═══════════════════════════════════════════

Each element in SCREEN_CONTEXT has:
- text: visible label or content description
- center: [x, y] coordinates to tap
- action: suggested action -- "tap", "type", "longpress", "scroll", or "read"
- enabled: false (only shown when disabled -- DO NOT tap disabled elements!)
- checked: true (only shown for ON checkboxes/toggles)
- focused: true (only shown when field has input focus)
- hint: placeholder text (only shown when present)
- editable: true (only shown for text input fields)
- scrollable: true (only shown for scrollable containers)

═══════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════

1. DISABLED ELEMENTS: If "enabled": false, DO NOT tap or interact with it. Find an alternative.
2. TEXT INPUT: ALWAYS include "coordinates" with "type" to focus the correct field. Without coordinates, text goes into whatever field was last focused -- which may be WRONG. If "editable": true, use "clear" first if field has existing text, then "type".
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
16. COPY-PASTE: PREFERRED: Use "copy_visible_text" action to copy text to clipboard programmatically -- this bypasses unreliable UI Copy buttons entirely. Then switch apps and "paste".
    ALTERNATIVE: Use "clipboard_set" with the text you see in SCREEN_CONTEXT, then switch apps and "paste".
    FALLBACK: Just "type" the text directly into the target app field.
    NEVER type a vague description -- always use the actual text content.
17. COORDINATES: ALWAYS use coordinates from SCREEN_CONTEXT elements (the "center" field). NEVER estimate or guess coordinates from screenshots -- they are inaccurate. Screenshots help you understand the layout; SCREEN_CONTEXT provides the correct tap targets.
18. BACK IS DESTRUCTIVE: NEVER use "back" to leave an app while you have a task in progress within it. You will LOSE all progress (typed text, loading responses, navigation state). Try all other in-app approaches first. Only use "back" after 5+ failed attempts within the app.
19. LEARN FROM HISTORY: Before choosing an action, check your earlier turns. If "enter" failed to submit a query before, do NOT try "enter" again -- find and tap the Send button. If specific coordinates didn't work, try different ones. Never repeat a strategy that already failed in this session.
20. EMAIL COMPOSE: ALWAYS use "compose_email" action when filling email fields. It fills To, Subject, and Body in the correct order. Pass the recipient email in "query" and body text in "text" (or it pastes from clipboard). NEVER manually type/paste into email fields -- you WILL put it in the wrong field.
21. INTENTS: ALWAYS prefer "intent" over UI navigation when the goal maps to a known intent pattern. Intents skip the UI entirely — no screen parsing, no stuck loops, no wasted steps. Use intents for: messaging (WhatsApp wa.me, SMS, email, calls), payments (UPI, PhonePe), navigation (Google Maps), productivity (alarms, timers, calendar events), media (Spotify, YouTube), and social (Instagram, Twitter/X profiles). Each intent replaces 5-10 UI navigation steps with a single action.

═══════════════════════════════════════════
ADAPTIVE PROBLEM-SOLVING
═══════════════════════════════════════════

NEVER REPEAT A FAILING ACTION more than once. If an action doesn't produce the expected result after 1 attempt, STOP and try a completely different approach.

SILENT SUCCESSES: Some actions succeed WITHOUT changing the screen:
- Tapping "Copy", "Share", "Like", or "Bookmark" buttons often works silently.
- If you tapped a Copy button and the screen didn't change, it likely WORKED. Move on to the next step instead of retrying.

SCREEN_CONTEXT IS YOUR DATA: The text in SCREEN_CONTEXT elements is data you already have. You can use it directly in:
- "clipboard_set" -- to set clipboard contents programmatically (more reliable than UI copy)
- "type" -- to enter text directly into any field
You do NOT need to "copy" text via UI -- you already have it from SCREEN_CONTEXT.

GOAL-ORIENTED THINKING: Focus on WHAT you need to accomplish, not on rigidly following planned steps. If a step fails, ask: "What was the PURPOSE of this step?" and find another way.
- Goal says "copy and send as email"? If Copy fails, use clipboard_set with SCREEN_CONTEXT text, or type it directly in the email.
- Goal says "search for X"? If enter doesn't submit, look for and tap the send/search button.
- Goal says "open app X"? Use "launch" with package name instead of hunting for icons.

SMART DECISION PRIORITIES: When multiple approaches can achieve the same result, prefer:
1. Programmatic actions (clipboard_set, launch) -- most reliable, no UI dependency.
2. Direct input (type, paste, enter) -- reliable when field is focused.
3. UI button interactions (tap, longpress) -- LEAST reliable, depends on correct coordinates.
Before choosing an action, ask: "Is there a simpler, more direct way to do this?"

PATIENCE WITH LOADING: AI chatbots (ChatGPT, Gemini, Claude) take 5-15 seconds to generate responses. After submitting a query, use "wait" 2-3 times before assuming it failed. Do NOT start scrolling or navigating away prematurely.

MINI PLAYERS & EXPANDABLE UI: Some apps (YouTube, Spotify, music players) have minimized players at the bottom. To expand them, use "swipe" UP from the mini-player coordinates -- tapping only toggles play/pause. For YouTube specifically, swipe from the mini-player upward to expand.

ESCAPE STUCK LOOPS -- when stuck, try in this priority order:
1. The action may have already succeeded silently -- MOVE ON to the next task step.
2. Use programmatic alternatives (clipboard_set, type, launch with URI).
3. Try a completely different UI element or interaction method.
4. Navigate away (back, home) ONLY as an absolute last resort -- this loses progress.`;
}

/**
 * Returns a tiny classifier prompt (~200 words) for Stage 2.
 * Given a goal + device capabilities, decides whether to fire an intent
 * or hand off to the UI agent.
 */
export function getClassifierPrompt(
  goal: string,
  capabilitySummary: string
): { system: string; user: string } {
  const system = `You are a goal classifier for an Android automation agent.

Given a user goal and the device's app/intent capabilities, decide the best approach:

Option A — INTENT: The goal can be achieved with a single Android intent (no screen interaction needed).
Return: {"type":"intent","intentAction":"...","uri":"...","extras":{...},"packageName":"..."}

Option B — UI: The goal requires screen interaction.
Return: {"type":"ui","app":"com.package.name","subGoal":"simplified task description"}
The app field is the package name to launch first. The subGoal is what the UI agent should do AFTER the app is open.

Option C — DONE: The goal is nonsensical or impossible.
Return: {"type":"done","reason":"..."}

Respond with ONLY a valid JSON object. No explanation.`;

  const user = `GOAL: ${goal}

DEVICE CAPABILITIES:
${capabilitySummary}`;

  return { system, user };
}

/**
 * Builds a dynamic system prompt for Stage 3 (UI Agent).
 *
 * Instead of listing all 23 actions every step, shows only actions
 * relevant to the current screen state. Results in ~50 lines vs 211.
 */
export function buildDynamicPrompt(options: {
  hasEditableFields: boolean;
  hasScrollable: boolean;
  foregroundApp?: string;
  appHints: string;
  isStuck: boolean;
}): string {
  const { hasEditableFields, hasScrollable, foregroundApp, appHints, isStuck } =
    options;

  // ── Base actions (always available) ──
  let actions = `Navigation:
  {"action": "tap", "coordinates": [x, y], "reason": "..."}
  {"action": "longpress", "coordinates": [x, y], "reason": "..."}
  {"action": "back", "reason": "Navigate back"}
  {"action": "home", "reason": "Go to home screen"}
  {"action": "wait", "reason": "Wait for screen to load"}
  {"action": "done", "reason": "Task is complete"}`;

  // ── Conditional actions ──
  if (hasEditableFields) {
    actions += `

Text Input (ALWAYS include coordinates to focus the correct field):
  {"action": "type", "coordinates": [x, y], "text": "...", "reason": "..."}
  {"action": "clear", "reason": "Clear current text field"}
  {"action": "enter", "reason": "Press Enter/submit"}
  {"action": "clipboard_set", "text": "...", "reason": "Set clipboard"}
  {"action": "paste", "coordinates": [x, y], "reason": "Paste clipboard"}`;
  }

  if (hasScrollable) {
    actions += `

Scrolling:
  {"action": "scroll", "direction": "up|down|left|right", "reason": "Scroll to see more"}`;
  }

  // Always include app control (lightweight)
  actions += `

App Control:
  {"action": "launch", "package": "com.app.name", "reason": "Open app"}
  {"action": "switch_app", "package": "com.app.name", "reason": "Switch app"}
  {"action": "intent", "intentAction": "android.intent.action.VIEW", "uri": "tel:123", "reason": "Fire Android intent directly"}`;

  // Multi-step actions (always useful)
  actions += `

Multi-Step:
  {"action": "read_screen", "reason": "Scroll through page, collect all text to clipboard"}
  {"action": "find_and_tap", "query": "Settings", "reason": "Scroll to find a VISIBLE button/label and tap it (NOT for typing text!)"}
  {"action": "copy_visible_text", "reason": "Copy all visible text to clipboard"}`;

  if (hasEditableFields) {
    actions += `
  {"action": "submit_message", "reason": "Find Send button and tap it"}
  {"action": "compose_email", "query": "email@addr", "reason": "Fill email fields"}`;
  }

  // ── Build full prompt ──
  let prompt = `You are an Android UI Agent. Achieve the sub-goal by interacting with the current screen.

You receive: GOAL, FOREGROUND_APP, LAST_ACTION_RESULT, SCREEN_CONTEXT (JSON elements with coordinates), SCREEN_CHANGE.

Output ONLY a valid JSON object with your next action. Include a "think" field with brief reasoning.

ACTIONS:
${actions}

RULES:
- Use coordinates from SCREEN_CONTEXT "center" field — never guess.
- Do NOT tap elements with "enabled": false.
- ALWAYS include "coordinates" with "type" action to focus the correct field.
- If SCREEN_CHANGE says "NOT changed", your last action had no effect — change strategy.
- Do NOT repeat an action that already failed.
- Say "done" as soon as the goal is achieved.
- CHECK RECENT_ACTIONS before every step: if you already typed text and tapped send, do NOT type it again.
- CHAT APP COMPLETION: After typing a message and tapping send in a chat app (WhatsApp, Messages, etc.), if the text field is now EMPTY and your message text appears in the conversation above, the message was SENT SUCCESSFULLY. Say "done" immediately.
- COPY-PASTE: Use clipboard_set with text from SCREEN_CONTEXT (most reliable), then paste. Or just type directly.
- TEXT INPUT vs FIND: To INPUT text (search queries, messages, form data), use "type". To tap a VISIBLE button/label, use "find_and_tap". NEVER use find_and_tap to enter text — it scrolls looking for text that doesn't exist yet.`;

  if (isStuck) {
    prompt += `

STUCK RECOVERY — your current approach is NOT working:
1. The action may have SUCCEEDED SILENTLY (copy/share/like buttons work without screen changes) — move on.
2. Use programmatic alternatives (clipboard_set, type, launch).
3. Try a completely different UI element or approach.
4. Navigate away (back/home) ONLY as absolute last resort.`;
  }

  if (appHints) {
    prompt += appHints;
  }

  return prompt;
}

// ─── Provider Implementation ────────────────────────────────────

const BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

const DEFAULT_MODELS: Record<string, string> = {
  openai: "gpt-4o",
  groq: "llama-3.3-70b-versatile",
  openrouter: "google/gemini-2.0-flash-001",
};

function getDefaultModel(provider: string): string {
  return DEFAULT_MODELS[provider] ?? "gpt-4o";
}

/**
 * Creates an OpenAI-compatible LLM provider.
 * Works with OpenAI, Groq, and OpenRouter since they all share the
 * same /chat/completions API format.
 */
export function getLlmProvider(config: LLMConfig): LLMProvider {
  const baseUrl = config.baseUrl ?? BASE_URLS[config.provider] ?? BASE_URLS.openai;
  const model = config.model ?? getDefaultModel(config.provider);

  return {
    async getAction(
      systemPrompt: string,
      userPrompt: string,
      imageBase64?: string,
      signal?: AbortSignal
    ): Promise<string> {
      const messages: Array<{ role: string; content: unknown }> = [
        { role: "system", content: systemPrompt },
      ];

      if (imageBase64) {
        messages.push({
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
                detail: "low",
              },
            },
          ],
        });
      } else {
        messages.push({ role: "user", content: userPrompt });
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: 1024,
          response_format: { type: "json_object" },
        }),
        signal,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`LLM API error (${response.status}): ${error}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message?.content ?? "";
    },
  };
}

// ─── JSON Response Parsing ──────────────────────────────────────

/**
 * Sanitizes raw LLM text so it can be parsed as JSON.
 * LLMs often put literal newlines inside JSON string values.
 */
function sanitizeJsonText(raw: string): string {
  return raw.replace(/\n/g, " ").replace(/\r/g, " ");
}

/**
 * Parses an LLM response into a JSON record. Handles:
 * - Clean JSON
 * - Markdown-wrapped code blocks (```json ... ```)
 * - Mixed text with embedded JSON
 *
 * Returns null on parse failure.
 */
export function parseJsonResponse(raw: string): Record<string, unknown> | null {
  // Try direct parse
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // continue
  }

  // Try with sanitized newlines
  try {
    return JSON.parse(sanitizeJsonText(raw)) as Record<string, unknown>;
  } catch {
    // continue
  }

  // Try extracting JSON from markdown code blocks or mixed text
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(sanitizeJsonText(match[0])) as Record<string, unknown>;
    } catch {
      // fall through
    }
  }

  return null;
}

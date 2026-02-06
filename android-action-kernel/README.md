# Android Action Kernel

An AI agent that takes control of your Android phone. You give it a goal in plain English — "order me a coffee on Swiggy" or "turn on dark mode" — and it figures out what to tap, type, and swipe to get it done.

It works by reading what's on the screen (the accessibility tree, and optionally a screenshot), sending that to an LLM, getting back a JSON action like `{"action": "tap", "coordinates": [540, 1200]}`, and executing it via ADB. Then it reads the screen again, and repeats. Perception, reasoning, action — in a loop, until the goal is achieved or it runs out of steps.

Think of it as an autopilot for your Android device, powered by whatever LLM you want.

## What it looks like in action

```
$ bun run src/kernel.ts
Enter your goal: Open YouTube and search for "lofi hip hop"

Screen resolution: 1080x2400
Android Action Kernel Started
Goal: Open YouTube and search for "lofi hip hop"
Provider: groq (llama-3.3-70b-versatile)
Max steps: 30 | Step delay: 2s
Vision: fallback | Streaming: true
Max elements: 40 | History: 10 steps

--- Step 1/30 ---
Scanning screen...
Foreground: com.google.android.launcher3/.uioverrides.QuickstepLauncher
Thinking.......
Think: I'm on the home screen. I should launch YouTube directly rather than looking for it.
Plan: Launch YouTube -> Tap search -> Type query -> Press enter -> Done
Progress: Step 1: launching YouTube
Decision: launch — Open YouTube app directly (842ms)
Launching: com.google.android.youtube
Messages in context: 3

--- Step 2/30 ---
Scanning screen...
Foreground: com.google.android.youtube/.HomeActivity
Thinking.....
Think: YouTube is open, showing the home feed. I need to tap the search icon.
Progress: Step 2: tapping search
Decision: tap — Tap the search icon at top right (623ms)
Tapping: (978, 142)
Messages in context: 5

--- Step 3/30 ---
Scanning screen...
Foreground: com.google.android.youtube/.SearchActivity
Thinking....
Think: Search field is focused and ready for input.
Progress: Step 3: typing query
Decision: type — Type the search query (501ms)
Typing: lofi hip hop
Messages in context: 7

--- Step 4/30 ---
Scanning screen...
Thinking...
Decision: enter — Submit the search (389ms)
Pressing Enter
Messages in context: 9

--- Step 5/30 ---
Scanning screen...
Thinking....
Think: Search results are showing lofi hip hop videos. Goal achieved.
Decision: done — Search results for "lofi hip hop" are displayed (412ms)

Task completed successfully.
Session log saved: logs/1706234567890-a3f2k1.json
```

## Quick start

You need three things: Bun (the JavaScript runtime), ADB (Android Debug Bridge), and an API key for at least one LLM provider.

### 1. Install prerequisites

**Bun** (if you don't have it):
```bash
curl -fsSL https://bun.sh/install | bash
```

**ADB** — comes with Android SDK Platform Tools:
```bash
# macOS
brew install android-platform-tools

# Ubuntu/Debian
sudo apt install android-tools-adb

# Or download directly from https://developer.android.com/tools/releases/platform-tools
```

### 2. Connect your Android device

Plug in your phone via USB, or connect over WiFi:

```bash
# USB — just plug it in, then verify:
adb devices
# Should show your device ID

# WiFi (after initial USB connection):
adb tcpip 5555
adb connect 192.168.1.42:5555
```

You'll need to enable **USB Debugging** on your phone:
- Go to Settings > About Phone > tap "Build Number" 7 times (unlocks Developer Options)
- Go to Settings > Developer Options > enable "USB Debugging"
- When you connect, tap "Allow" on the USB debugging prompt

### 3. Install dependencies and configure

```bash
cd android-action-kernel
bun install
cp .env.example .env
```

Edit `.env` and add your API key. The fastest way to get started is with Groq (free tier):

```bash
# .env
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
```

### 4. Run it

```bash
bun run src/kernel.ts
```

It'll prompt you for a goal. Type what you want the phone to do, and watch it go.

## Goals you can try

Here are some real tasks the kernel can handle — from simple to complex:

```
# Simple navigation
Open Settings
Go to the home screen and open the calculator

# App-specific tasks
Open WhatsApp and send "I'm running late" to Mom
Open Chrome and search for "best restaurants near me"
Open YouTube and play the first trending video

# System settings
Turn on WiFi
Set display brightness to maximum
Enable dark mode

# Multi-app workflows
Take a screenshot of the weather app and share it on WhatsApp
Open Google Maps, search for "coffee", and navigate to the nearest one
Copy the tracking number from the Amazon order page and search it on Google

# Complex tasks
Order a medium pepperoni pizza from Dominos
Book an Uber from home to the airport
Check my Gmail for any emails from Amazon and read the latest one
```

The kernel knows 15 different actions and uses them in combination. For a multi-step task like "order a pizza", it might: launch the app, tap the search bar, type "pepperoni", tap a result, scroll down to size options, tap "medium", add to cart — each step reasoning about what's on screen right now.

## Choosing an LLM provider

The kernel works with four providers. You only need one.

| Provider | Best for | Vision? | Cost |
|---|---|---|---|
| **Groq** | Getting started, fast iteration | No | Free tier available |
| **OpenAI** | Best accuracy with GPT-4o, full vision | Yes | Pay per token |
| **OpenRouter** | Access to 200+ models (Claude, Gemini, etc.) | Yes | Pay per token |
| **AWS Bedrock** | Enterprise, Claude on AWS | Yes (Anthropic models) | Pay per token |

### Groq (recommended to start)

Groq is the fastest and has a generous free tier. It doesn't support vision (screenshots), but the accessibility tree is usually enough.

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
GROQ_MODEL=llama-3.3-70b-versatile
# Faster but less capable: llama-3.1-8b-instant
```

Get your key at [console.groq.com](https://console.groq.com).

### OpenAI

GPT-4o gives the best results, especially with vision enabled. More expensive but more reliable on complex tasks.

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your_key_here
OPENAI_MODEL=gpt-4o
# Cheaper alternative: gpt-4o-mini
```

### OpenRouter

One API key, access to hundreds of models. Great if you want to try Claude, Gemini, or open-source models.

```bash
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-v1-your_key_here
OPENROUTER_MODEL=anthropic/claude-3.5-sonnet
# Other popular options:
#   google/gemini-2.0-flash-001   (fast + cheap)
#   openai/gpt-4o                 (multimodal)
#   deepseek/deepseek-chat        (cost efficient)
```

Get your key at [openrouter.ai/keys](https://openrouter.ai/keys).

### AWS Bedrock

For enterprise setups. Uses your AWS credential chain (`aws configure`), no API key needed in `.env`.

```bash
LLM_PROVIDER=bedrock
AWS_REGION=us-east-1
BEDROCK_MODEL=anthropic.claude-3-sonnet-20240229-v1:0
# Or: us.meta.llama3-3-70b-instruct-v1:0
```

## Configuration deep dive

All settings live in `.env`. Here's what each one does and when you'd change it.

### Agent behavior

```bash
MAX_STEPS=30          # How many perception-action cycles before giving up.
                      # Simple tasks finish in 3-5 steps. Complex multi-app
                      # workflows might need 20+. Default is 30.

STEP_DELAY=2          # Seconds to wait after each action before reading the
                      # screen again. This gives the UI time to settle. Too low
                      # and you'll read a screen mid-animation. Default is 2.

STUCK_THRESHOLD=3     # If the screen hasn't changed for this many steps, the
                      # kernel injects a "you're stuck, try something else"
                      # hint into the LLM prompt. Default is 3.

MAX_RETRIES=3         # Retries on ADB failures (device disconnected, etc.)
                      # with exponential backoff. Default is 3.
```

### Vision

```bash
VISION_MODE=fallback  # Controls when screenshots are sent to the LLM.
                      #
                      # "off"      — Never send screenshots. Cheapest option.
                      #              Works fine for most native Android apps
                      #              where the accessibility tree has all
                      #              the info the LLM needs.
                      #
                      # "fallback" — Only capture a screenshot when the
                      #              accessibility tree returns zero elements.
                      #              This happens with games, WebViews, Flutter
                      #              apps, and custom-drawn UI. This is the
                      #              default and a good middle ground.
                      #
                      # "always"   — Send a screenshot every single step. Most
                      #              accurate but uses significantly more tokens.
                      #              Use this with GPT-4o or Claude when you
                      #              need the LLM to actually *see* the screen
                      #              (visual layouts, icons without text labels,
                      #              image recognition, etc.)
```

### Smart filtering

```bash
MAX_ELEMENTS=40       # A typical Android screen has 50-200 UI elements. Most
                      # of them are decorative (dividers, spacers, background
                      # containers). This setting caps how many elements the
                      # LLM sees after scoring and deduplication. Default is 40.
                      #
                      # Lower = faster + cheaper but may miss relevant buttons.
                      # Higher = more context but slower + more expensive.
```

### Conversation memory

```bash
MAX_HISTORY_STEPS=10  # The LLM sees the full conversation history — its
                      # previous observations and decisions. This setting caps
                      # how many past steps to keep (oldest get trimmed).
                      # Default is 10. Higher values give the LLM more context
                      # about what it already tried, but use more tokens.
```

### Streaming

```bash
STREAMING_ENABLED=true  # When true, LLM responses stream in token-by-token,
                        # showing progress dots (".....") in the terminal so
                        # you know it's working. When false, the full response
                        # comes back all at once after a longer pause.
```

### Logging

```bash
LOG_DIR=logs          # Where session logs are written. Each run produces a
                      # JSON file with every step: what was on screen, what
                      # the LLM decided, how long it took, success/failure.
                      # Great for debugging and replays.
```

## How it works under the hood

The kernel runs a loop. Each iteration has six phases:

```
     +------------------+
     |  1. PERCEIVE     |  Dump the accessibility tree via uiautomator
     |     the screen   |  Parse XML into UI elements, detect foreground app
     +--------+---------+
              |
     +--------v---------+
     |  2. FILTER        |  Score elements (editable +8, focused +6, clickable +5...)
     |     & COMPACT     |  Deduplicate by position, keep top 40, strip to essentials
     +--------+---------+
              |
     +--------v---------+
     |  3. CAPTURE       |  If VISION_MODE allows: take a screenshot,
     |     screenshot    |  encode as base64 for the LLM
     +--------+---------+
              |
     +--------v---------+
     |  4. REASON        |  Send the full conversation (system prompt + all past
     |     via LLM       |  observations + current screen + screenshot) to the LLM
     +--------+---------+
              |
     +--------v---------+
     |  5. EXECUTE       |  Parse the LLM's JSON response, run the ADB command
     |     action        |  (tap, type, swipe, launch, etc.)
     +--------+---------+
              |
     +--------v---------+
     |  6. LOG & DIFF    |  Write step to session log, diff screen state,
     |                   |  detect stuck loops, wait for UI to settle
     +--------+---------+
              |
              +---------> back to step 1
```

### The 15 actions

The LLM responds with JSON. Here's every action it can choose:

**Navigation** — moving around the UI
```json
{"action": "tap", "coordinates": [540, 1200], "reason": "Tap the Sign In button"}
{"action": "longpress", "coordinates": [540, 1200], "reason": "Long press to open context menu"}
{"action": "swipe", "direction": "up", "reason": "Scroll down to see more items"}
{"action": "enter", "reason": "Submit the search query"}
{"action": "back", "reason": "Go back to previous screen"}
{"action": "home", "reason": "Return to home screen"}
```

**Text input** — typing and clearing
```json
{"action": "clear", "reason": "Clear old text before typing new query"}
{"action": "type", "text": "best pizza near me", "reason": "Type the search query"}
```

**App control** — launching apps and intents
```json
{"action": "launch", "package": "com.whatsapp", "reason": "Open WhatsApp"}
{"action": "launch", "uri": "https://maps.google.com/?q=pizza+near+me", "reason": "Open Maps with search"}
{"action": "launch", "package": "com.whatsapp", "uri": "content://media/external/images/1",
 "extras": {"android.intent.extra.TEXT": "Check this out"}, "reason": "Share image to WhatsApp"}
```

**Data** — screenshots and clipboard
```json
{"action": "screenshot", "reason": "Capture current screen state"}
{"action": "screenshot", "filename": "order_confirmation.png", "reason": "Save proof of purchase"}
{"action": "clipboard_get", "reason": "Read what's in clipboard"}
{"action": "clipboard_set", "text": "Hello", "reason": "Copy text to clipboard"}
```

**System** — shell commands, waiting, and completion
```json
{"action": "shell", "command": "am force-stop com.broken.app", "reason": "Kill unresponsive app"}
{"action": "wait", "reason": "Wait for page to finish loading"}
{"action": "done", "reason": "Goal is complete — search results are showing"}
```

### Planning and thinking

The LLM doesn't just pick actions blindly. Before every action, it reasons about what it sees and where it is in its plan:

```json
{
  "think": "I see the YouTube search results page. The first video is 'lofi hip hop radio - beats to relax/study to' which matches what the user wants. I should tap on it to start playing.",
  "plan": [
    "Launch YouTube",
    "Search for lofi hip hop",
    "Play the first result",
    "Verify it's playing"
  ],
  "planProgress": "Step 3 of 4: playing the first result",
  "action": "tap",
  "coordinates": [540, 450],
  "reason": "Tap the first search result to play it"
}
```

The `think` field shows the LLM's reasoning — what it sees on screen and why it's making this choice. The `plan` is a high-level roadmap it creates at the start and updates as it goes. `planProgress` tracks where it is in that roadmap.

When the agent gets stuck (screen not changing for several steps), the kernel tells the LLM: "Your plan isn't working. Create a new one with a different approach." This forces it to re-evaluate rather than stubbornly retrying the same thing.

### Smart element filtering

A raw Android accessibility dump can have 150+ elements. Most are useless — background containers, invisible spacers, decorative views. Sending all of them wastes tokens and confuses the LLM.

The kernel filters elements in three steps:

**1. Deduplication** — Elements at the same coordinates (within 5px) are collapsed. If two elements overlap at the same spot, the one with the higher relevance score wins.

**2. Scoring** — Each element gets a score based on how useful it is:

| Property | Score | Why |
|---|---|---|
| Enabled | +10 | Disabled elements can't be interacted with |
| Editable (text field) | +8 | You almost always need to interact with input fields |
| Currently focused | +6 | Focused elements are what the user is likely targeting |
| Clickable / long-clickable | +5 | Buttons and links are primary interaction targets |
| Has visible text | +3 | Elements with text are more informative |

**3. Compaction** — The top N elements (default 40) are stripped to just the fields the LLM needs. A "Sign In" button goes from this:

```json
{
  "id": "com.app:id/login_btn",
  "text": "Sign In",
  "type": "Button",
  "bounds": "[360,1740][720,1860]",
  "center": [540, 1800],
  "size": [360, 120],
  "clickable": true,
  "editable": false,
  "enabled": true,
  "checked": false,
  "focused": false,
  "selected": false,
  "scrollable": false,
  "longClickable": false,
  "password": false,
  "hint": "",
  "action": "tap",
  "parent": "LoginForm",
  "depth": 4
}
```

To this:

```json
{"text": "Sign In", "center": [540, 1800], "action": "tap"}
```

The LLM gets exactly what it needs — the text label, where to tap, and what kind of interaction is expected. Default flags (enabled=true, checked=false, etc.) are omitted since they add no information. Non-default flags are included, so a disabled button would show `"enabled": false` as a clear signal not to tap it.

### Multi-turn conversation memory

This is one of the most important features. Unlike a stateless setup where every LLM call starts fresh, the kernel maintains a full conversation across all steps. Each step adds two messages:

- A **user message** with the current screen state (filtered elements + screenshot + foreground app + screen diff)
- An **assistant message** with the LLM's JSON decision

So by step 5, the LLM has the full history of what it saw and did in steps 1 through 4. It remembers that it already typed "lofi hip hop" and won't type it again. It knows it already tried tapping a certain button and it didn't work. It can reference earlier observations to make better decisions.

To keep context from growing forever, the kernel trims it to the last N steps (default 10), always keeping the system prompt. Older steps get replaced with a brief `[5 earlier steps omitted]` marker.

Here's what the conversation looks like internally by step 3:

```
[system]  You are an Android Driver Agent...
[user]    GOAL: Open YouTube... FOREGROUND_APP: launcher... SCREEN_CONTEXT: [...]
[assistant]  {"action": "launch", "package": "com.google.android.youtube", ...}
[user]    GOAL: Open YouTube... FOREGROUND_APP: youtube/HomeActivity... SCREEN_CONTEXT: [...]
[assistant]  {"action": "tap", "coordinates": [978, 142], ...}
[user]    GOAL: Open YouTube... FOREGROUND_APP: youtube/SearchActivity... SCREEN_CONTEXT: [...]
```

The LLM sees this entire chain and can reason about it: "I already launched YouTube (step 1) and tapped search (step 2). Now I see the search field is focused, so I should type the query."

### Screen resolution detection

The kernel auto-detects your device's screen resolution at startup by running `adb shell wm size`. It checks for an override resolution first (set by apps or developer settings), then falls back to the physical resolution.

Swipe coordinates are calculated as proportional ratios of the screen dimensions. The reference device is 1080x2400, and all coordinates scale proportionally:

- **Scroll up**: swipe from 62.5% to 20.8% of screen height (center X)
- **Scroll down**: swipe from 20.8% to 62.5% of screen height (center X)
- **Swipe left**: swipe from 74.1% to 18.5% of screen width (center Y)
- **Swipe right**: swipe from 18.5% to 74.1% of screen width (center Y)

This means swiping works correctly whether you have a 1080x2400 phone, a 1440x3200 tablet, a 720x1280 budget phone, or a custom emulator resolution. If resolution detection fails, it falls back to the hardcoded 1080x2400 coordinates.

### Session logging

Every run produces a JSON log in the `logs/` directory. The log captures everything:

- **Session metadata** — goal, LLM provider, model, start/end timestamps
- **Per-step data** — foreground app, element count, screen change status, full LLM decision (including think/plan), action result, LLM latency, action latency
- **Summary stats** — total steps, success/failure counts, whether the task completed

A `.partial.json` file is written after every single step, so even if the process crashes mid-run, you don't lose the data. At the end of the run, the final `.json` summary is written and logged to console.

Here's what one step looks like in the log:

```json
{
  "step": 3,
  "timestamp": "2024-01-25T14:30:22.456Z",
  "foregroundApp": "com.google.android.youtube/.SearchActivity",
  "elementCount": 47,
  "screenChanged": true,
  "llmDecision": {
    "action": "type",
    "text": "lofi hip hop",
    "reason": "Type search query",
    "think": "Search field is focused and empty. Time to type the query.",
    "plan": ["Launch YouTube", "Tap search", "Type query", "Submit", "Done"],
    "planProgress": "Step 3: typing the search query"
  },
  "actionResult": {
    "success": true,
    "message": "Typed \"lofi hip hop\""
  },
  "llmLatencyMs": 623,
  "actionLatencyMs": 145
}
```

These logs are useful for:
- **Debugging** — why did the agent tap the wrong button on step 7?
- **Performance tuning** — which steps are slow? Is the LLM taking too long?
- **Replays** — trace through the exact sequence of observations and decisions
- **Comparing models** — run the same goal with different LLMs and compare their logs

### Streaming

When streaming is enabled (the default), LLM responses arrive token-by-token instead of all at once. In the terminal, you'll see progress dots while the LLM thinks:

```
Thinking...........
```

Each dot is a chunk of the response arriving. This matters because some LLM calls take 2-5 seconds, and without streaming you'd just see a frozen terminal with no feedback. Under the hood:

- **OpenAI / Groq**: Uses `stream: true` on the chat completions API
- **OpenRouter**: Uses Vercel AI SDK's `streamText()` which returns a `.textStream` async iterable
- **Bedrock (Anthropic)**: Uses `InvokeModelWithResponseStreamCommand` for native streaming
- **Bedrock (Meta/other)**: Falls back to non-streaming (these models don't support it through Bedrock's streaming API)

If you set `STREAMING_ENABLED=false`, every provider falls back to the standard request-response pattern.

## Architecture

Seven source files, no subdirectories, no frameworks beyond the LLM SDKs:

```
android-action-kernel/src/
  kernel.ts          Main agent loop — ties everything together
  actions.ts         15 action implementations + device detection + ADB retry logic
  llm-providers.ts   LLM abstraction (4 providers) + system prompt + message types
  sanitizer.ts       Accessibility XML parser + smart filtering + scoring
  config.ts          Reads .env into a typed Config object
  constants.ts       ADB keycodes, coordinate ratios, defaults, magic values
  logger.ts          Session logging with crash-safe partial writes
```

### Data flow in one step

```
kernel.ts                    actions.ts                  sanitizer.ts
    |                            |                           |
    |-- runAdbCommand() -------->|                           |
    |   "uiautomator dump"       |                           |
    |<-- XML file pulled --------|                           |
    |                            |                           |
    |-- getInteractiveElements() --------------------------->|
    |   (parse raw XML)          |                           |
    |<-- UIElement[] ----------------------------------------|
    |                            |                           |
    |-- filterElements() ----------------------------------->|
    |   (score, dedup, compact)  |                           |
    |<-- CompactUIElement[] ---------------------------------|
    |                            |                           |
    |-- getForegroundApp() ----->|                           |
    |<-- "com.app/.Activity" ---|                           |
    |                            |                           |
    |                   llm-providers.ts                     |
    |                            |                           |
    |-- getDecisionStream() --->|                           |
    |   (messages[])             |-- (calls OpenAI/etc.) -->|
    |<-- ActionDecision --------|                           |
    |                            |                           |
    |-- executeAction() ------->|                           |
    |   (tap, type, swipe...)    |-- runAdbCommand() ------>|
    |<-- ActionResult ----------|                           |
    |                            |                           |
    |                    logger.ts                           |
    |                            |                           |
    |-- logStep() ------------->|                           |
    |   (writes .partial.json)   |                           |
```

### Extending the kernel

**Adding a new LLM provider:**

1. Implement the `LLMProvider` interface in `llm-providers.ts`:
```typescript
export interface LLMProvider {
  readonly capabilities: {
    supportsImages: boolean;     // Can this provider handle base64 screenshots?
    supportsStreaming: boolean;  // Does it support token-by-token streaming?
  };
  getDecision(messages: ChatMessage[]): Promise<ActionDecision>;
  getDecisionStream?(messages: ChatMessage[]): AsyncIterable<string>;
}
```

2. Add a case to the `getLlmProvider()` factory
3. Add config fields to `config.ts` and env vars to `.env.example`

**Adding a new action:**

1. Add any new fields to `ActionDecision` in `actions.ts`
2. Write an `executeNewAction()` function
3. Add the case to the `executeAction()` switch
4. Document the JSON format in the `SYSTEM_PROMPT` in `llm-providers.ts` — this is how the LLM learns the action exists

## Commands

```bash
bun install              # Install dependencies (run this first)
bun run src/kernel.ts    # Start the agent (prompts for a goal)
bun run build            # Compile to dist/ (bun build --target bun)
bun run typecheck        # Type-check with zero errors (tsc --noEmit)
```

## Troubleshooting

**"adb: command not found"**
ADB isn't in your PATH. Either install it via your package manager (see Quick Start) or set `ADB_PATH=/full/path/to/adb` in `.env`.

**"no devices/emulators found"**
Your phone isn't connected or USB debugging isn't enabled. Run `adb devices` — you should see a device ID, not an empty list. Check that you tapped "Allow" on the USB debugging prompt on your phone.

**"Warning: ADB screen capture failed"**
Sometimes `uiautomator dump` fails transiently — the screen is in transition, an animation is playing, or the device is briefly unresponsive. The kernel retries automatically with exponential backoff. If it keeps failing, try increasing `STEP_DELAY` to give the UI more time to settle between steps.

**"Warning: Could not detect screen resolution"**
The kernel falls back to default 1080x2400 coordinates. Swipes might not scroll correctly on devices with very different resolutions. You can check your device manually with `adb shell wm size`.

**The agent keeps doing the same thing over and over**
This is the "stuck loop" problem. The kernel detects it automatically after `STUCK_THRESHOLD` steps (default 3) and tells the LLM to try a completely different approach. If it's still stuck after that, the task might need a more capable model. Try GPT-4o or Claude via OpenRouter — they're significantly better at complex multi-step reasoning than smaller models.

**"Could not parse LLM response"**
The LLM sometimes returns malformed JSON, especially cheaper/smaller models. The kernel has fallback parsing — it tries to extract JSON from markdown code blocks and mixed text. If parsing fails completely, it falls back to a "wait" action and tries again next step. If this happens frequently, switch to a larger model. OpenAI and Groq have `response_format: json_object` enabled which almost eliminates this problem.

**Vision not working with Groq**
Groq doesn't support image inputs. The kernel handles this gracefully — it sends a `[Screenshot attached]` text placeholder instead of the actual image. If you need the LLM to actually see the screen (for games, WebViews, apps with no accessibility labels), use OpenAI, OpenRouter, or Bedrock with an Anthropic model.

**High token usage / expensive runs**
A few things to try:
- Set `VISION_MODE=off` if you don't need screenshots (biggest token saver)
- Lower `MAX_ELEMENTS` from 40 to 20 or 25
- Lower `MAX_HISTORY_STEPS` from 10 to 5
- Use a cheaper model (gpt-4o-mini, llama-3.1-8b-instant, deepseek-chat)

## How is this different from...

**Appium / UIAutomator2 test frameworks** — Those require you to write explicit test scripts with selectors, waits, and assertions. This kernel is goal-driven: you say *what* you want, and the LLM figures out *how*. No selectors, no XPaths, no test scripts. The tradeoff is that it's non-deterministic — the LLM might take a slightly different path each time.

**Phone mirroring tools (scrcpy, Vysor)** — Those let *you* control the phone remotely with your own hands. This lets an *AI* control it autonomously. Different use case entirely.

**Android accessibility services** — Those run *on the phone* as installed apps. This runs on *your computer* and talks to the device over ADB. No app installation required on the phone — just USB debugging enabled.

**Cloud device farms (BrowserStack, Firebase Test Lab)** — Those are designed for automated testing at scale. This is designed for single-device autonomous task completion. You could potentially use this kernel with a cloud device, but that's not the primary use case.

## License

MIT

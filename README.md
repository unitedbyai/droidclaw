# droidclaw

> an ai agent that controls your android phone. give it a goal in plain english — it figures out what to tap, type, and swipe.

**[Download Android APK (v0.5.3)](https://github.com/unitedbyai/droidclaw/releases/download/v0.5.3/app-debug.apk)** | **[Dashboard](https://app.droidclaw.ai)** | **[Discord](https://discord.gg/SaCs3cPQdY)**

i wanted to turn my old android devices into ai agents. after a few hours reverse engineering accessibility trees and playing with tailscale.. it worked.

think of it this way — a few years back, we could automate android with predefined flows. now imagine that automation layer has an llm brain. it can read any screen, understand what's happening, decide what to do, and execute. you don't need api's. you don't need to build integrations. just install your favourite apps and tell the agent what you want done.

one of the coolest things it can do right now is delegate incoming requests to chatgpt, gemini, or google search on the device... and bring the result back. no api keys for those services needed — it just uses the apps like a human would.

```
$ bun run src/kernel.ts
enter your goal: open youtube and search for "lofi hip hop"

--- step 1/30 ---
think: i'm on the home screen. launching youtube.
action: launch (842ms)

--- step 2/30 ---
think: youtube is open. tapping search icon.
action: tap (623ms)

--- step 3/30 ---
think: search field focused.
action: type "lofi hip hop" (501ms)

--- step 4/30 ---
action: enter (389ms)

--- step 5/30 ---
think: search results showing. done.
action: done (412ms)
```

---

## how it works

the core idea is dead simple — a **perception → reasoning → action** loop that repeats until the goal is done (or it runs out of steps).

```
                         ┌─────────────────────────────────────────┐
                         │              your goal                  │
                         │   "send good morning to mom on whatsapp"│
                         └────────────────┬────────────────────────┘
                                          │
                                          ▼
                    ┌─────────────────────────────────────────────────┐
                    │                                                 │
                    │              ┌──────────────┐                   │
                    │              │  1. perceive  │                   │
                    │              └──────┬───────┘                   │
                    │                     │                           │
                    │    dump accessibility tree via adb               │
                    │    parse xml → interactive ui elements           │
                    │    diff with previous screen (detect changes)    │
                    │    optionally capture screenshot                 │
                    │                     │                           │
                    │                     ▼                           │
                    │              ┌──────────────┐                   │
                    │              │  2. reason    │                   │
                    │              └──────┬───────┘                   │
                    │                     │                           │
                    │    send screen state + goal + history to llm     │
                    │    llm returns { think, plan, action }           │
                    │    "i see the search icon at (890, 156).         │
                    │     i should tap it."                            │
                    │                     │                           │
                    │                     ▼                           │
                    │              ┌──────────────┐                   │
                    │              │  3. act       │                   │
                    │              └──────┬───────┘                   │
                    │                     │                           │
                    │    execute via adb: tap, type, swipe, etc.       │
                    │    feed result back to llm on next step          │
                    │    check if goal is done                        │
                    │                     │                           │
                    │                     ▼                           │
                    │               done? ─────── yes ──→ exit        │
                    │                │                                │
                    │                no                               │
                    │                │                                │
                    │                └─────── loop back to perceive   │
                    │                                                 │
                    └─────────────────────────────────────────────────┘
```

### what makes it not fall apart

llms controlling ui's sounds fragile. and it is, if you don't handle the failure modes. here's what droidclaw does:

- **stuck loop detection** — if the screen doesn't change for 3 steps, recovery hints get injected into the prompt. context-aware hints based on what type of action is failing (tap vs swipe vs wait).
- **repetition tracking** — a sliding window of recent actions catches retry loops even across screen changes. if the agent taps the same coordinates 3+ times, it gets told to stop and try something else.
- **drift detection** — if the agent spams navigation actions (swipe, back, wait) without interacting with anything, it gets nudged to take direct action.
- **vision fallback** — when the accessibility tree is empty (webviews, flutter apps, games), a screenshot gets sent to the llm instead, with coordinate-based tap suggestions.
- **action feedback** — every action result (success/failure + message) gets fed back to the llm on the next step. the agent knows whether its last move worked.
- **multi-turn memory** — conversation history is maintained across steps so the llm has context about what it already tried.

---

## setup

### quick install

```bash
curl -fsSL https://droidclaw.ai/install.sh | sh
```

this installs bun and adb if missing, clones the repo, and sets up `.env`.

### manual install

**prerequisites:**

- [bun](https://bun.sh) (required — node/npm won't work. droidclaw uses bun-specific apis like `Bun.spawnSync` and native `.env` loading)
- [adb](https://developer.android.com/tools/adb) (android debug bridge — comes with android sdk platform tools)
- an android phone with usb debugging enabled
- an llm provider api key (or ollama for fully local)

```bash
# install adb
# macos:
brew install android-platform-tools
# linux:
sudo apt install android-tools-adb
# windows:
# download from https://developer.android.com/tools/releases/platform-tools

# install bun
curl -fsSL https://bun.sh/install | bash

# clone and setup
git clone https://github.com/unitedbyai/droidclaw.git
cd droidclaw
bun install
cp .env.example .env
```

### configure your llm

edit `.env` and pick a provider. fastest way to start is groq (free tier):

```bash
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
```

or run fully local with [ollama](https://ollama.com) (no api key, no internet needed):

```bash
ollama pull llama3.2
# then in .env:
LLM_PROVIDER=ollama
OLLAMA_MODEL=llama3.2
```

### connect your phone

1. go to **settings → about phone → tap "build number" 7 times** to enable developer options
2. go to **settings → developer options → enable "usb debugging"**
3. plug in via usb and tap "allow" on the phone when prompted

```bash
adb devices   # should show your device
```

### run it

```bash
bun run src/kernel.ts
# type your goal and press enter
```

---

## three ways to use it

droidclaw has three modes, each for a different use case:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│   interactive mode          workflows             flows             │
│   ─────────────────    ─────────────────    ─────────────────       │
│                                                                     │
│   type a goal and       chain goals          fixed sequences        │
│   the agent figures     across multiple      of taps and types.     │
│   it out on the fly.    apps with ai.        no llm, instant.       │
│                                                                     │
│   $ bun run              --workflow            --flow               │
│     src/kernel.ts         file.json             file.yaml           │
│                                                                     │
│   best for:             best for:            best for:              │
│   one-off tasks,        multi-app tasks,     things you do          │
│   exploration,          recurring routines,  exactly the same       │
│   quick commands        morning briefings    way every time         │
│                                                                     │
│   uses llm: yes         uses llm: yes        uses llm: no          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### interactive mode

just type what you want:

```bash
bun run src/kernel.ts
# enter your goal: open settings and turn on dark mode
```

### workflows (ai-powered, multi-app)

workflows are json files describing a sequence of sub-goals. each step can optionally switch to a different app. the llm decides how to navigate, what to tap, what to type.

```bash
bun run src/kernel.ts --workflow examples/workflows/research/weather-to-whatsapp.json
```

```json
{
  "name": "weather to whatsapp",
  "steps": [
    {
      "app": "com.google.android.googlequicksearchbox",
      "goal": "search for chennai weather today"
    },
    {
      "goal": "share the result to whatsapp contact Sanju"
    }
  ]
}
```

you can inject specific data into steps using `formData`:

```json
{
  "name": "slack standup",
  "steps": [
    {
      "app": "com.Slack",
      "goal": "open #standup channel, type the message and send it",
      "formData": {
        "Message": "yesterday: api integration\ntoday: tests\nblockers: none"
      }
    }
  ]
}
```

### flows (no ai, instant execution)

for tasks where you don't need ai thinking — just a fixed sequence of taps and types. no llm calls, instant execution. think of it like a macro.

```bash
bun run src/kernel.ts --flow examples/flows/send-whatsapp.yaml
```

```yaml
appId: com.whatsapp
name: Send WhatsApp Message
---
- launchApp
- wait: 2
- tap: "Contact Name"
- wait: 1
- tap: "Message"
- type: "hello from droidclaw"
- tap: "Send"
- done: "Message sent"
```

### quick comparison

| | workflows | flows |
|---|---|---|
| format | json | yaml |
| uses ai | yes | no |
| handles ui changes | yes | no |
| speed | slower (llm calls) | instant |
| best for | complex/multi-app tasks | simple repeatable tasks |

---

## example workflows

35 ready-to-use workflows organised by category:

**[messaging](examples/workflows/messaging/)** — whatsapp, telegram, slack, email
- [slack-standup](examples/workflows/messaging/slack-standup.json) — post daily standup to a channel
- [whatsapp-broadcast](examples/workflows/messaging/whatsapp-broadcast.json) — send a message to multiple contacts
- [telegram-send-message](examples/workflows/messaging/telegram-send-message.json) — send a telegram message
- [email-reply](examples/workflows/messaging/email-reply.json) — draft and send an email reply
- [whatsapp-to-email](examples/workflows/messaging/whatsapp-to-email.json) — forward whatsapp messages to email
- [slack-check-messages](examples/workflows/messaging/slack-check-messages.json) — read unread slack messages
- [email-digest](examples/workflows/messaging/email-digest.json) — summarise recent emails
- [telegram-channel-digest](examples/workflows/messaging/telegram-channel-digest.json) — digest a telegram channel
- [whatsapp-reply](examples/workflows/messaging/whatsapp-reply.json) — reply to a whatsapp message
- [send-whatsapp-vi](examples/workflows/messaging/send-whatsapp-vi.json) — send whatsapp to a specific contact

**[social](examples/workflows/social/)** — instagram, youtube, cross-posting
- [social-media-post](examples/workflows/social/social-media-post.json) — post across platforms
- [social-media-engage](examples/workflows/social/social-media-engage.json) — like/comment on posts
- [instagram-post-check](examples/workflows/social/instagram-post-check.json) — check recent instagram posts
- [youtube-watch-later](examples/workflows/social/youtube-watch-later.json) — save videos to watch later

**[productivity](examples/workflows/productivity/)** — calendar, notes, github, notifications
- [morning-briefing](examples/workflows/productivity/morning-briefing.json) — read messages, calendar, weather across apps
- [github-check-prs](examples/workflows/productivity/github-check-prs.json) — check open pull requests
- [calendar-create-event](examples/workflows/productivity/calendar-create-event.json) — create a calendar event
- [notes-capture](examples/workflows/productivity/notes-capture.json) — capture a quick note
- [notification-cleanup](examples/workflows/productivity/notification-cleanup.json) — clear and triage notifications
- [screenshot-share-slack](examples/workflows/productivity/screenshot-share-slack.json) — screenshot and share to slack
- [translate-and-reply](examples/workflows/productivity/translate-and-reply.json) — translate a message and reply
- [logistics-workflow](examples/workflows/productivity/logistics-workflow.json) — multi-app logistics coordination

**[research](examples/workflows/research/)** — search, compare, monitor
- [weather-to-whatsapp](examples/workflows/research/weather-to-whatsapp.json) — get weather via google, share to whatsapp
- [multi-app-research](examples/workflows/research/multi-app-research.json) — research across multiple apps
- [price-comparison](examples/workflows/research/price-comparison.json) — compare prices across shopping apps
- [news-roundup](examples/workflows/research/news-roundup.json) — collect news from multiple sources
- [google-search-report](examples/workflows/research/google-search-report.json) — search google and save results
- [check-flight-status](examples/workflows/research/check-flight-status.json) — check flight status

**[lifestyle](examples/workflows/lifestyle/)** — food, transport, music, fitness
- [food-order](examples/workflows/lifestyle/food-order.json) — order food from a delivery app
- [uber-ride](examples/workflows/lifestyle/uber-ride.json) — book an uber ride
- [spotify-playlist](examples/workflows/lifestyle/spotify-playlist.json) — create or add to a spotify playlist
- [maps-commute](examples/workflows/lifestyle/maps-commute.json) — check commute time
- [fitness-log](examples/workflows/lifestyle/fitness-log.json) — log a workout
- [expense-tracker](examples/workflows/lifestyle/expense-tracker.json) — log an expense
- [wifi-password-share](examples/workflows/lifestyle/wifi-password-share.json) — share wifi password
- [do-not-disturb](examples/workflows/lifestyle/do-not-disturb.json) — toggle do not disturb with exceptions

**[flows](examples/flows/)** — 5 deterministic flow templates (no ai)
- [send-whatsapp](examples/flows/send-whatsapp.yaml) — send a whatsapp message
- [google-search](examples/flows/google-search.yaml) — run a google search
- [create-contact](examples/flows/create-contact.yaml) — add a new contact
- [clear-notifications](examples/flows/clear-notifications.yaml) — clear all notifications
- [toggle-wifi](examples/flows/toggle-wifi.yaml) — toggle wifi on/off

---

## actions

the agent has 28 actions it can use. these are the building blocks — each one maps to an adb command.

**basic interactions:**
`tap` `type` `enter` `longpress` `clear` `paste` `swipe` `scroll`

**navigation:**
`home` `back` `launch` `switch_app` `open_url` `open_settings` `notifications`

**clipboard:**
`clipboard_get` `clipboard_set`

**multi-step skills** (compound actions that handle common patterns):
`read_screen` `submit_message` `copy_visible_text` `wait_for_content` `find_and_tap` `compose_email`

**system:**
`screenshot` `shell` `keyevent` `pull_file` `push_file` `wait` `done`

the multi-step skills are interesting — they replace 5-10 manual actions with a single call. for example, `read_screen` auto-scrolls through the entire screen, collects all text, and copies it to clipboard. `compose_email` fills To, Subject, and Body fields in the correct order using android intents. these dramatically reduce the number of llm decisions needed.

---

## providers

| provider | cost | vision | notes |
|---|---|---|---|
| groq | free tier | no | fastest to start, great for most tasks |
| ollama | free (local) | yes* | no api key, runs entirely on your machine |
| openrouter | per token | yes | 200+ models, single api |
| openai | per token | yes | gpt-4o, strong reasoning |
| bedrock | per token | yes | claude/llama on aws |

*ollama vision requires a vision-capable model like `llama3.2-vision` or `llava`

---

## config

### optional CLI web research

The CLI agent can search the public web and fetch pages through
[Parallel Search MCP](https://docs.parallel.ai/integrations/mcp/search-mcp)
without switching away from the app on your phone. Search uses Fast mode, with
no Parallel account or API key required. Enable it in `.env`:

```bash
WEB_SEARCH_PROVIDER=parallel
WEB_SEARCH_TIMEOUT_MS=30000
```

Run `bun run src/kernel.ts` and ask for a task such as "research the latest Bun
release notes and draft a summary in my notes app". The agent can use
`web_search` with a `query`, then `web_fetch` with a source `url`; source text and
URLs return to its next decision. Existing phone actions remain available,
including Google search and signed-in app content. This option applies to the
CLI agent and its AI workflows, not the hosted dashboard or deterministic flows.

The default `WEB_SEARCH_PROVIDER=device` keeps research on the phone. Set it to
`none` to explicitly disable host-side web research. Neither setting contacts
Parallel. Enabling `parallel` permits the model to send search queries and page
URLs to Parallel; results are also included in local session logs. Requests have
a configurable timeout and service errors, including anonymous usage limits,
return as failed actions without automatically switching providers. Each goal
uses a new opaque search session ID, reused for its search and fetch calls.

Developers embedding `runAgent` can cancel web requests with an `AbortSignal`:
`runAgent(goal, maxSteps, { signal })`.

all configuration lives in `.env`. here's what you can tweak:

| key | default | what it does |
|---|---|---|
| `LLM_PROVIDER` | groq | which llm to use (groq/openai/ollama/bedrock/openrouter) |
| `MAX_STEPS` | 30 | how many steps before the agent gives up |
| `STEP_DELAY` | 2 | seconds to wait between actions (lets the ui settle) |
| `STUCK_THRESHOLD` | 3 | how many unchanged steps before stuck recovery kicks in |
| `VISION_MODE` | fallback | `off` / `fallback` (only when accessibility tree is empty) / `always` |
| `MAX_ELEMENTS` | 40 | max ui elements sent to the llm per step (scored & ranked) |
| `MAX_HISTORY_STEPS` | 10 | how many past steps to keep in conversation context |
| `STREAMING_ENABLED` | true | stream llm responses (shows progress dots) |
| `WEB_SEARCH_PROVIDER` | device | CLI web research: `device`, opt-in `parallel`, or `none` |
| `WEB_SEARCH_TIMEOUT_MS` | 30000 | timeout for each Search MCP request |
| `LOG_DIR` | logs | directory for session json logs |

---

## source code

the entire agent is ~10 files in `src/`:

```
src/
├── kernel.ts          the main perception → reasoning → action loop
├── actions.ts         28 action implementations (tap, type, swipe, etc.)
├── skills.ts          6 multi-step skills (read_screen, compose_email, etc.)
├── workflow.ts        workflow orchestration engine (multi-app sub-goals)
├── flow.ts            yaml flow runner (deterministic, no llm)
├── llm-providers.ts   5 providers + the system prompt that teaches the llm
├── sanitizer.ts       accessibility xml parser → structured ui elements
├── config.ts          env config loader with validation
├── constants.ts       keycodes, swipe coordinates, defaults
└── logger.ts          session logging (json, crash-safe partial writes)
```

### data flow through the codebase

```
                    kernel.ts
                       │
          ┌────────────┼────────────────┐
          │            │                │
          ▼            ▼                ▼
     sanitizer.ts   llm-providers.ts   actions.ts
     (parse screen)  (ask the llm)     (execute via adb)
                                        │
                                        ├── skills.ts
                                        │   (multi-step compound actions)
                                        │
     config.ts ◄────── all files read config
     constants.ts ◄─── keycodes, coordinates

     workflow.ts ── calls kernel.runAgent() per sub-goal
     flow.ts ────── calls actions.executeAction() directly (no llm)
     logger.ts ◄─── kernel writes step logs here
```

---

## remote control with tailscale

the default setup is usb — phone plugged into your laptop. but you can go much further.

install [tailscale](https://tailscale.com) on both your android device and your laptop/server. once they're on the same tailnet, connect adb over the network:

```bash
# on your phone: enable wireless debugging
# settings → developer options → wireless debugging
# note the ip:port shown

# from anywhere in the world:
adb connect <phone-tailscale-ip>:<port>
adb devices   # should show your phone

bun run src/kernel.ts
```

now your phone is a remote ai agent. leave it on a desk plugged into power, and control it from a vps, your laptop at a cafe, or a cron job running workflows every morning at 8am. the phone doesn't need to be on the same wifi or even in the same country.

this is what makes old android devices useful again — they become always-on agents that can do things on apps that don't have api's.

---

## commands

```bash
bun run src/kernel.ts                          # interactive mode (prompts for goal)
bun run src/kernel.ts --workflow file.json     # run a workflow
bun run src/kernel.ts --flow file.yaml         # run a deterministic flow
bun install                                    # install dependencies
bun run build                                  # compile to dist/
bun run typecheck                              # type-check (tsc --noEmit)
bun run test:search                            # scripted CLI/MCP caller tests (no phone or keys)
```

---

## troubleshooting

**"adb: command not found"** — install adb (`brew install android-platform-tools` on mac) or set `ADB_PATH` in `.env` to point to your adb binary.

**"no devices found"** — make sure usb debugging is enabled, you've tapped "allow" on the phone, and the cable supports data transfer (not just charging).

**agent keeps repeating the same action** — stuck detection should handle this automatically. if it persists, try a stronger model (groq's llama-3.3-70b or openai's gpt-4o).

**empty accessibility tree** — some apps (flutter, webviews, games) don't expose accessibility info. set `VISION_MODE=always` in `.env` to send screenshots every step instead.

**swipe coordinates seem off** — droidclaw auto-detects screen resolution at startup. if your device has an unusual resolution, check the console output on step 1 for the detected resolution.

---

## contributors

built by [unitedby.ai](https://unitedby.ai) — an open ai community

- [sanju sivalingam](https://sanju.sh)
- [somasundaram mahesh](https://msomu.com)

## license

mit

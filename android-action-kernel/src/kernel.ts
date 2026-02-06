/**
 * Android Action Kernel - Main Agent Loop (TypeScript/Bun Edition)
 *
 * An AI agent that controls Android devices through the accessibility API.
 * Uses LLMs to make decisions based on screen context.
 *
 * Features:
 *   - Perception -> Reasoning -> Action loop
 *   - Screen state diffing (stuck loop detection)
 *   - Error recovery with retries
 *   - Vision fallback & always-on multimodal screenshots
 *   - Dynamic early exit on goal completion
 *   - Smart element filtering (compact JSON, top-N scoring)
 *   - Multi-turn conversation memory
 *   - Multi-step planning (think/plan/planProgress)
 *   - Streaming LLM responses
 *   - Session logging with crash-safe partial writes
 *   - Auto-detect screen resolution & foreground app
 *   - 15 actions: tap, type, enter, swipe, home, back, wait, done,
 *     longpress, screenshot, launch, clear, clipboard_get, clipboard_set, shell
 *
 * Usage:
 *     bun run src/kernel.ts
 */

import { existsSync, readFileSync } from "fs";

import { Config } from "./config.js";
import {
  executeAction,
  runAdbCommand,
  getScreenResolution,
  getForegroundApp,
  initDeviceContext,
  type ActionDecision,
  type ActionResult,
} from "./actions.js";
import {
  getLlmProvider,
  trimMessages,
  SYSTEM_PROMPT,
  type LLMProvider,
  type ChatMessage,
  type ContentPart,
} from "./llm-providers.js";
import {
  getInteractiveElements,
  computeScreenHash,
  filterElements,
  type UIElement,
} from "./sanitizer.js";
import {
  DEVICE_SCREENSHOT_PATH,
  LOCAL_SCREENSHOT_PATH,
} from "./constants.js";
import { SessionLogger } from "./logger.js";

// ===========================================
// Screen Perception
// ===========================================

interface ScreenState {
  elements: UIElement[];
  compactJson: string;
}

/**
 * Dumps the current UI XML and returns parsed elements + compact filtered JSON for the LLM.
 */
function getScreenState(): ScreenState {
  try {
    runAdbCommand(["shell", "uiautomator", "dump", Config.SCREEN_DUMP_PATH]);
    runAdbCommand(["pull", Config.SCREEN_DUMP_PATH, Config.LOCAL_DUMP_PATH]);
  } catch {
    console.log("Warning: ADB screen capture failed.");
    return { elements: [], compactJson: "Error: Could not capture screen." };
  }

  if (!existsSync(Config.LOCAL_DUMP_PATH)) {
    return { elements: [], compactJson: "Error: Could not capture screen." };
  }

  const xmlContent = readFileSync(Config.LOCAL_DUMP_PATH, "utf-8");
  const elements = getInteractiveElements(xmlContent);
  const compact = filterElements(elements, Config.MAX_ELEMENTS);
  return { elements, compactJson: JSON.stringify(compact) };
}

/**
 * Captures a screenshot and returns the base64-encoded PNG, or null on failure.
 */
function captureScreenshotBase64(): string | null {
  try {
    runAdbCommand(["shell", "screencap", "-p", DEVICE_SCREENSHOT_PATH]);
    runAdbCommand(["pull", DEVICE_SCREENSHOT_PATH, LOCAL_SCREENSHOT_PATH]);
    if (existsSync(LOCAL_SCREENSHOT_PATH)) {
      const buffer = readFileSync(LOCAL_SCREENSHOT_PATH);
      return Buffer.from(buffer).toString("base64");
    }
  } catch {
    console.log("Warning: Screenshot capture failed.");
  }
  return null;
}

// ===========================================
// Screen State Diffing
// ===========================================

interface ScreenDiff {
  changed: boolean;
  addedTexts: string[];
  removedTexts: string[];
  summary: string;
}

function diffScreenState(
  prevElements: UIElement[],
  currElements: UIElement[]
): ScreenDiff {
  const prevTexts = new Set(prevElements.map((e) => e.text).filter(Boolean));
  const currTexts = new Set(currElements.map((e) => e.text).filter(Boolean));

  const addedTexts = [...currTexts].filter((t) => !prevTexts.has(t));
  const removedTexts = [...prevTexts].filter((t) => !currTexts.has(t));

  const prevHash = computeScreenHash(prevElements);
  const currHash = computeScreenHash(currElements);
  const changed = prevHash !== currHash;

  let summary = "";
  if (!changed) {
    summary = "Screen has NOT changed since last action.";
  } else {
    const parts: string[] = [];
    if (addedTexts.length > 0) {
      parts.push(`New on screen: ${addedTexts.slice(0, 5).join(", ")}`);
    }
    if (removedTexts.length > 0) {
      parts.push(`Gone from screen: ${removedTexts.slice(0, 5).join(", ")}`);
    }
    summary = parts.join(". ") || "Screen layout changed.";
  }

  return { changed, addedTexts, removedTexts, summary };
}

// ===========================================
// Streaming LLM Consumer
// ===========================================

async function getDecisionStreaming(
  llm: LLMProvider,
  messages: ChatMessage[]
): Promise<ActionDecision> {
  if (!Config.STREAMING_ENABLED || !llm.capabilities.supportsStreaming || !llm.getDecisionStream) {
    return llm.getDecision(messages);
  }

  let accumulated = "";
  process.stdout.write("Thinking");
  for await (const chunk of llm.getDecisionStream(messages)) {
    accumulated += chunk;
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  return parseJsonResponse(accumulated);
}

/** Simple JSON parser with markdown fallback (duplicated from llm-providers for streaming path) */
function parseJsonResponse(text: string): ActionDecision {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*?\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through
      }
    }
    console.log(`Warning: Could not parse streamed response: ${text.slice(0, 200)}`);
    return { action: "wait", reason: "Failed to parse response, waiting" };
  }
}

// ===========================================
// Main Agent Loop
// ===========================================

async function runAgent(goal: string, maxSteps?: number): Promise<void> {
  const steps = maxSteps ?? Config.MAX_STEPS;

  // Phase 1A: Auto-detect screen resolution
  const resolution = getScreenResolution();
  if (resolution) {
    initDeviceContext(resolution);
    console.log(`Screen resolution: ${resolution[0]}x${resolution[1]}`);
  } else {
    console.log("Screen resolution: using default 1080x2400 swipe coords");
  }

  console.log("Android Action Kernel Started");
  console.log(`Goal: ${goal}`);
  console.log(`Provider: ${Config.LLM_PROVIDER} (${Config.getModel()})`);
  console.log(`Max steps: ${steps} | Step delay: ${Config.STEP_DELAY}s`);
  console.log(`Vision: ${Config.VISION_MODE} | Streaming: ${Config.STREAMING_ENABLED}`);
  console.log(`Max elements: ${Config.MAX_ELEMENTS} | History: ${Config.MAX_HISTORY_STEPS} steps`);

  const llm = getLlmProvider();

  // Phase 2B: Session logging
  const logger = new SessionLogger(
    Config.LOG_DIR,
    goal,
    Config.LLM_PROVIDER,
    Config.getModel()
  );

  // Phase 4A: Multi-turn conversation memory
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  let prevElements: UIElement[] = [];
  let stuckCount = 0;

  for (let step = 0; step < steps; step++) {
    console.log(`\n--- Step ${step + 1}/${steps} ---`);

    // 1. Perception: Capture screen state
    console.log("Scanning screen...");
    const { elements, compactJson: screenContext } = getScreenState();

    // 1B. Foreground app detection
    const foregroundApp = getForegroundApp();
    if (foregroundApp) {
      console.log(`Foreground: ${foregroundApp}`);
    }

    // 2. Screen diff: detect stuck loops
    let diffContext = "";
    let screenChanged = true;
    if (step > 0) {
      const diff = diffScreenState(prevElements, elements);
      screenChanged = diff.changed;
      diffContext = `\n\nSCREEN_CHANGE: ${diff.summary}`;

      if (!diff.changed) {
        stuckCount++;
        console.log(
          `Warning: Screen unchanged for ${stuckCount} step(s).`
        );
        if (stuckCount >= Config.STUCK_THRESHOLD) {
          console.log(
            `Stuck for ${stuckCount} steps. Injecting recovery hint.`
          );
          diffContext +=
            `\nWARNING: You have been stuck for ${stuckCount} steps. ` +
            `The screen is NOT changing. Try a DIFFERENT action: ` +
            `swipe to scroll, press back, go home, or launch a different app.` +
            `\nYour plan is not working. Create a NEW plan with a different approach.`;
        }
      } else {
        stuckCount = 0;
      }
    }
    prevElements = elements;

    // 3. Vision: capture screenshot based on VISION_MODE
    let screenshotBase64: string | null = null;
    let visionContext = "";

    const shouldCaptureVision =
      Config.VISION_MODE === "always" ||
      (Config.VISION_MODE === "fallback" && elements.length === 0);

    if (shouldCaptureVision) {
      screenshotBase64 = captureScreenshotBase64();
      if (elements.length === 0) {
        visionContext =
          "\n\nVISION_FALLBACK: The accessibility tree returned NO elements. " +
          "A screenshot has been captured. The screen likely contains custom-drawn " +
          "content (game, WebView, or Flutter). Try using coordinate-based taps on " +
          "common UI positions, or use 'back'/'home' to navigate away.";
      }
      if (screenshotBase64 && llm.capabilities.supportsImages) {
        console.log("Sending screenshot to LLM");
      }
    }

    // 4. Build user message with all context
    const foregroundLine = foregroundApp
      ? `FOREGROUND_APP: ${foregroundApp}\n\n`
      : "";
    const textContent =
      `GOAL: ${goal}\n\n${foregroundLine}SCREEN_CONTEXT:\n${screenContext}${diffContext}${visionContext}`;

    // Build content parts (text + optional image)
    const userContent: ContentPart[] = [{ type: "text", text: textContent }];
    if (screenshotBase64 && llm.capabilities.supportsImages) {
      userContent.push({
        type: "image",
        base64: screenshotBase64,
        mimeType: "image/png",
      });
    }

    messages.push({ role: "user", content: userContent });

    // Trim messages to keep within history limit
    const trimmed = trimMessages(messages, Config.MAX_HISTORY_STEPS);

    // 5. Reasoning: Get LLM decision
    const llmStart = performance.now();
    let decision: ActionDecision;
    try {
      decision = await getDecisionStreaming(llm, trimmed);
    } catch (err) {
      console.log(`LLM Error: ${(err as Error).message}`);
      console.log("Falling back to wait action.");
      decision = { action: "wait", reason: "LLM request failed, waiting" };
    }
    const llmLatency = performance.now() - llmStart;

    // Log thinking and planning
    if (decision.think) {
      console.log(`Think: ${decision.think}`);
    }
    if (decision.plan) {
      console.log(`Plan: ${decision.plan.join(" -> ")}`);
    }
    if (decision.planProgress) {
      console.log(`Progress: ${decision.planProgress}`);
    }
    console.log(`Decision: ${decision.action} — ${decision.reason ?? "no reason"} (${Math.round(llmLatency)}ms)`);

    // Append assistant response to conversation
    messages.push({
      role: "assistant",
      content: JSON.stringify(decision),
    });

    // 6. Action: Execute the decision
    const actionStart = performance.now();
    let result: ActionResult;
    try {
      result = executeAction(decision);
    } catch (err) {
      console.log(`Action Error: ${(err as Error).message}`);
      result = { success: false, message: (err as Error).message };
    }
    const actionLatency = performance.now() - actionStart;

    // Log step
    logger.logStep(
      step + 1,
      foregroundApp,
      elements.length,
      screenChanged,
      decision,
      result,
      Math.round(llmLatency),
      Math.round(actionLatency)
    );

    console.log(`Messages in context: ${trimmed.length}`);

    // 7. Check for goal completion
    if (decision.action === "done") {
      console.log("\nTask completed successfully.");
      logger.finalize(true);
      return;
    }

    // Wait for UI to update
    await Bun.sleep(Config.STEP_DELAY * 1000);
  }

  console.log("\nMax steps reached. Task may be incomplete.");
  logger.finalize(false);
}

// ===========================================
// Entry Point
// ===========================================

async function main(): Promise<void> {
  try {
    Config.validate();
  } catch (e) {
    console.log(`Configuration Error: ${(e as Error).message}`);
    return;
  }

  // Read user input from stdin
  process.stdout.write("Enter your goal: ");
  const goal = await new Promise<string>((resolve) => {
    const reader = Bun.stdin.stream().getReader();
    reader.read().then(({ value }) => {
      resolve(new TextDecoder().decode(value).trim());
      reader.releaseLock();
    });
  });

  if (!goal) {
    console.log("No goal provided. Exiting.");
    return;
  }

  await runAgent(goal);
}

main();

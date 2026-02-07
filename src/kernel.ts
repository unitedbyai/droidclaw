/**
 * DroidClaw - Main Agent Loop (TypeScript/Bun Edition)
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
  sanitizeCoordinates,
  type ActionDecision,
  type ActionResult,
} from "./actions.js";
import { executeSkill } from "./skills.js";
import {
  getLlmProvider,
  trimMessages,
  parseJsonResponse,
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

// ===========================================
// Main Agent Loop
// ===========================================

export async function runAgent(goal: string, maxSteps?: number): Promise<{ success: boolean; stepsUsed: number }> {
  const steps = maxSteps ?? Config.MAX_STEPS;

  // Phase 1A: Auto-detect screen resolution
  const resolution = getScreenResolution();
  if (resolution) {
    initDeviceContext(resolution);
    console.log(`Screen resolution: ${resolution[0]}x${resolution[1]}`);
  } else {
    console.log("Screen resolution: using default 1080x2400 swipe coords");
  }

  console.log("DroidClaw Started");
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
  let recentActions: string[] = []; // Sliding window of action signatures for repetition detection
  let lastActionFeedback = ""; // Result of previous action to feed back to LLM

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

          // Context-aware recovery hints based on what actions are failing
          const failingTypes = new Set(
            recentActions.slice(-stuckCount).map((a) => a.split("(")[0])
          );

          let hint = `\nWARNING: You have been stuck for ${stuckCount} steps. The screen is NOT changing.`;

          if (failingTypes.has("tap") || failingTypes.has("longpress")) {
            hint +=
              `\nYour tap/press actions are having NO EFFECT. Likely causes:` +
              `\n- The action SUCCEEDED SILENTLY (copy/share/like buttons often work without screen changes). If so, MOVE ON to the next step.` +
              `\n- The element is not actually interactive at those coordinates.` +
              `\n- USE "clipboard_set" to set clipboard text directly instead of UI copy buttons.` +
              `\n- Or just "type" the text directly in the target app — you already have the text from SCREEN_CONTEXT.`;
          }
          if (failingTypes.has("swipe") || failingTypes.has("scroll")) {
            hint +=
              `\nSwiping is having no effect — you may be at the end of scrollable content. Try interacting with visible elements or navigate with "back"/"home".`;
          }

          hint +=
            `\nYour plan is NOT working. You MUST create a completely NEW plan with a different approach. Think about the underlying GOAL, not the specific steps that failed.`;

          diffContext += hint;
        }
      } else {
        stuckCount = 0;
      }
    }
    prevElements = elements;

    // 2B. Repetition detection (persists across screen changes — catches retry loops)
    if (recentActions.length >= 3) {
      const freq = new Map<string, number>();
      for (const a of recentActions) freq.set(a, (freq.get(a) ?? 0) + 1);
      const [topAction, topCount] = [...freq.entries()].reduce(
        (a, b) => (b[1] > a[1] ? b : a),
        ["", 0]
      );
      if (topCount >= 3) {
        diffContext +=
          `\nREPETITION_ALERT: You have attempted "${topAction}" ${topCount} times in recent steps. ` +
          `This action is clearly NOT working — do NOT attempt it again.`;
        if (topAction.includes("tap") || topAction.includes("longpress")) {
          diffContext +=
            ` ALTERNATIVES: (1) If you were copying text, the copy likely already succeeded — move on to the next step. ` +
            `(2) Use "clipboard_set" with the text from SCREEN_CONTEXT to set clipboard directly. ` +
            `(3) Use "type" to enter text directly in the target app. ` +
            `(4) Navigate away with "back" or "home" and try a different path.`;
        }
      }
    }

    // 2C. Drift detection — agent is floundering (swipe/back/wait/screenshot spam)
    if (recentActions.length >= 4) {
      const navigationActions = new Set(["swipe", "scroll", "back", "home", "wait"]);
      const navCount = recentActions
        .slice(-5)
        .filter((a) => navigationActions.has(a.split("(")[0])).length;
      if (navCount >= 4) {
        diffContext +=
          `\nDRIFT_WARNING: Your last ${navCount} actions were all navigation/waiting (swipe, back, wait, screenshot) with no direct interaction. ` +
          `You are not making progress. STOP scrolling/navigating and take a DIRECT action: ` +
          `tap a specific button from SCREEN_CONTEXT, use "type" to enter text, or use "clipboard_set". ` +
          `If you need to submit a query in a chat app, find the Send button in SCREEN_CONTEXT and tap it.`;
      }
    }

    // 3. Vision: capture screenshot based on VISION_MODE or stuck recovery
    let screenshotBase64: string | null = null;
    let visionContext = "";

    const isStuckVision = stuckCount >= 2; // Send screenshot after 2 unchanged steps
    const shouldCaptureVision =
      Config.VISION_MODE === "always" ||
      (Config.VISION_MODE === "fallback" && elements.length === 0) ||
      isStuckVision;

    if (shouldCaptureVision) {
      screenshotBase64 = captureScreenshotBase64();
      if (elements.length === 0) {
        visionContext =
          "\n\nVISION_FALLBACK: The accessibility tree returned NO elements. " +
          "A screenshot has been captured. The screen likely contains custom-drawn " +
          "content (game, WebView, or Flutter). Try using coordinate-based taps on " +
          "common UI positions, or use 'back'/'home' to navigate away.";
      } else if (isStuckVision) {
        visionContext =
          "\n\nVISION_ASSIST: You have been stuck — a screenshot is attached. " +
          "Use the screenshot to VISUALLY identify the correct field positions, " +
          "buttons, and layout. The accessibility tree may be misleading about " +
          "which field is which. Trust what you SEE in the screenshot over the " +
          "element coordinates when they conflict.";
      }
      if (screenshotBase64 && llm.capabilities.supportsImages) {
        console.log(isStuckVision ? "Stuck — sending screenshot for visual assist" : "Sending screenshot to LLM");
      }
    }

    // 4. Build user message with all context
    const foregroundLine = foregroundApp
      ? `FOREGROUND_APP: ${foregroundApp}\n\n`
      : "";
    const actionFeedbackLine = lastActionFeedback
      ? `LAST_ACTION_RESULT: ${lastActionFeedback}\n\n`
      : "";
    const textContent =
      `GOAL: ${goal}\n\n${foregroundLine}${actionFeedbackLine}SCREEN_CONTEXT:\n${screenContext}${diffContext}${visionContext}`;

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

    // 6. Action: Execute the decision (multi-step actions or basic actions)
    const MULTI_STEP_ACTIONS = ["read_screen", "submit_message", "copy_visible_text", "wait_for_content", "find_and_tap", "compose_email"];
    const actionStart = performance.now();
    let result: ActionResult;
    try {
      if (MULTI_STEP_ACTIONS.includes(decision.action)) {
        result = executeSkill(decision, elements);
      } else {
        result = executeAction(decision);
      }
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

    // Track action signature for repetition detection
    const actionSig = decision.coordinates
      ? `${decision.action}(${decision.coordinates.join(",")})`
      : decision.action;
    recentActions.push(actionSig);
    if (recentActions.length > 8) recentActions.shift();

    // Capture action result feedback for next iteration
    lastActionFeedback = `${actionSig} → ${result.success ? "OK" : "FAILED"}: ${result.message}`;

    console.log(`Messages in context: ${trimmed.length}`);

    // 7. Check for goal completion
    if (decision.action === "done") {
      console.log("\nTask completed successfully.");
      logger.finalize(true);
      return { success: true, stepsUsed: step + 1 };
    }

    // Wait for UI to update
    await Bun.sleep(Config.STEP_DELAY * 1000);
  }

  console.log("\nMax steps reached. Task may be incomplete.");
  logger.finalize(false);
  return { success: false, stepsUsed: steps };
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

  // Check for --workflow flag
  const workflowIdx = process.argv.findIndex((a) => a === "--workflow" || a.startsWith("--workflow="));
  if (workflowIdx !== -1) {
    const arg = process.argv[workflowIdx];
    const workflowFile = arg.includes("=")
      ? arg.split("=")[1]
      : process.argv[workflowIdx + 1];

    if (!workflowFile) {
      console.log("Error: --workflow requires a JSON file path.");
      process.exit(1);
    }

    const { runWorkflow } = await import("./workflow.js");
    const workflow = JSON.parse(await Bun.file(workflowFile).text());
    const result = await runWorkflow(workflow);

    console.log(`\n=== Workflow "${result.name}" ===`);
    for (const step of result.steps) {
      const status = step.success ? "OK" : "FAILED";
      console.log(`  [${status}] ${step.goal} (${step.stepsUsed} steps)${step.error ? ` — ${step.error}` : ""}`);
    }
    console.log(`\nResult: ${result.success ? "All steps completed" : "Some steps failed"}`);
    process.exit(result.success ? 0 : 1);
  }

  // Interactive mode: read goal from stdin
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

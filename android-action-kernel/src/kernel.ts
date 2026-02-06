/**
 * Android Action Kernel - Main Agent Loop (TypeScript/Bun Edition)
 *
 * An AI agent that controls Android devices through the accessibility API.
 * Uses LLMs to make decisions based on screen context.
 *
 * Features:
 *   - Perception → Reasoning → Action loop
 *   - Screen state diffing (stuck loop detection)
 *   - Error recovery with retries
 *   - Vision fallback when accessibility tree is empty
 *   - Dynamic early exit on goal completion
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
  type ActionDecision,
  type ActionResult,
} from "./actions.js";
import { getLlmProvider, type LLMProvider } from "./llm-providers.js";
import {
  getInteractiveElements,
  computeScreenHash,
  type UIElement,
} from "./sanitizer.js";
import {
  DEVICE_SCREENSHOT_PATH,
  LOCAL_SCREENSHOT_PATH,
} from "./constants.js";

// ===========================================
// Screen Perception
// ===========================================

/**
 * Dumps the current UI XML and returns parsed elements + JSON string.
 */
function getScreenState(): { elements: UIElement[]; json: string } {
  try {
    runAdbCommand(["shell", "uiautomator", "dump", Config.SCREEN_DUMP_PATH]);
    runAdbCommand(["pull", Config.SCREEN_DUMP_PATH, Config.LOCAL_DUMP_PATH]);
  } catch {
    console.log("Warning: ADB screen capture failed.");
    return { elements: [], json: "Error: Could not capture screen." };
  }

  if (!existsSync(Config.LOCAL_DUMP_PATH)) {
    return { elements: [], json: "Error: Could not capture screen." };
  }

  const xmlContent = readFileSync(Config.LOCAL_DUMP_PATH, "utf-8");
  const elements = getInteractiveElements(xmlContent);
  return { elements, json: JSON.stringify(elements, null, 2) };
}

/**
 * Captures a screenshot and returns the local file path.
 * Used as a vision fallback when the accessibility tree is empty.
 */
function captureScreenshot(): string | null {
  try {
    runAdbCommand(["shell", "screencap", "-p", DEVICE_SCREENSHOT_PATH]);
    runAdbCommand(["pull", DEVICE_SCREENSHOT_PATH, LOCAL_SCREENSHOT_PATH]);
    if (existsSync(LOCAL_SCREENSHOT_PATH)) {
      return LOCAL_SCREENSHOT_PATH;
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
// Action History Formatting
// ===========================================

function formatActionHistory(
  actionHistory: ActionDecision[],
  resultHistory: ActionResult[]
): string {
  if (actionHistory.length === 0) return "";

  const lines = actionHistory.map((entry, i) => {
    const actionType = entry.action ?? "unknown";
    const reason = entry.reason ?? "N/A";
    const result = resultHistory[i];
    const outcome = result ? (result.success ? "OK" : "FAILED") : "";

    if (actionType === "type") {
      return `Step ${i + 1}: typed "${entry.text ?? ""}" - ${reason} [${outcome}]`;
    }
    if (actionType === "tap") {
      return `Step ${i + 1}: tapped ${JSON.stringify(entry.coordinates ?? [])} - ${reason} [${outcome}]`;
    }
    if (actionType === "launch") {
      return `Step ${i + 1}: launched ${entry.package ?? entry.uri ?? ""} - ${reason} [${outcome}]`;
    }
    if (actionType === "screenshot") {
      return `Step ${i + 1}: took screenshot - ${reason} [${outcome}]`;
    }
    return `Step ${i + 1}: ${actionType} - ${reason} [${outcome}]`;
  });

  return "\n\nPREVIOUS_ACTIONS:\n" + lines.join("\n");
}

// ===========================================
// Main Agent Loop
// ===========================================

async function runAgent(goal: string, maxSteps?: number): Promise<void> {
  const steps = maxSteps ?? Config.MAX_STEPS;

  console.log("Android Action Kernel Started");
  console.log(`Goal: ${goal}`);
  console.log(`Provider: ${Config.LLM_PROVIDER} (${Config.getModel()})`);
  console.log(`Max steps: ${steps} | Step delay: ${Config.STEP_DELAY}s`);
  console.log(`Vision fallback: ${Config.VISION_ENABLED ? "ON" : "OFF"}`);

  const llm = getLlmProvider();
  const actionHistory: ActionDecision[] = [];
  const resultHistory: ActionResult[] = [];
  let prevElements: UIElement[] = [];
  let stuckCount = 0;

  for (let step = 0; step < steps; step++) {
    console.log(`\n--- Step ${step + 1}/${steps} ---`);

    // 1. Perception: Capture screen state
    console.log("Scanning screen...");
    const { elements, json: screenContext } = getScreenState();

    // 2. Screen diff: detect stuck loops
    let diffContext = "";
    if (step > 0) {
      const diff = diffScreenState(prevElements, elements);
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
            `swipe to scroll, press back, go home, or launch a different app.`;
        }
      } else {
        stuckCount = 0;
      }
    }
    prevElements = elements;

    // 3. Vision fallback: if accessibility tree is empty, use screenshot
    let visionContext = "";
    if (elements.length === 0 && Config.VISION_ENABLED) {
      console.log("Accessibility tree empty. Attempting vision fallback...");
      const screenshotPath = captureScreenshot();
      if (screenshotPath) {
        visionContext =
          "\n\nVISION_FALLBACK: The accessibility tree returned NO elements. " +
          "A screenshot has been captured. The screen likely contains custom-drawn " +
          "content (game, WebView, or Flutter). Try using coordinate-based taps on " +
          "common UI positions, or use 'back'/'home' to navigate away. " +
          "If you know the app package name, use 'launch' to restart it.";
        console.log("Vision fallback: screenshot captured for context.");
      }
    }

    // 4. Reasoning: Get LLM decision
    console.log("Thinking...");
    const historyStr = formatActionHistory(actionHistory, resultHistory);
    const fullContext = screenContext + historyStr + diffContext + visionContext;

    let decision: ActionDecision;
    try {
      decision = await llm.getDecision(goal, fullContext, actionHistory);
    } catch (err) {
      console.log(`LLM Error: ${(err as Error).message}`);
      console.log("Falling back to wait action.");
      decision = { action: "wait", reason: "LLM request failed, waiting for retry" };
    }

    console.log(`Decision: ${decision.action} — ${decision.reason ?? "no reason"}`);

    // 5. Action: Execute the decision
    let result: ActionResult;
    try {
      result = executeAction(decision);
    } catch (err) {
      console.log(`Action Error: ${(err as Error).message}`);
      result = { success: false, message: (err as Error).message };
    }

    // Track history
    actionHistory.push(decision);
    resultHistory.push(result);

    // 6. Check for goal completion
    if (decision.action === "done") {
      console.log("\nTask completed successfully.");
      return;
    }

    // Wait for UI to update
    await Bun.sleep(Config.STEP_DELAY * 1000);
  }

  console.log("\nMax steps reached. Task may be incomplete.");
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

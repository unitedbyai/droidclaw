/**
 * Server-side agent loop for DroidClaw.
 *
 * Adapts the CLI agent loop (src/kernel.ts) to work over WebSocket.
 * The loop runs on the server: gets screen state from the phone via
 * sessions.sendCommand(), calls an LLM for decision-making, and sends
 * action commands back to the device.
 *
 * Core flow:
 *  1. Send get_screen to device
 *  2. Build prompt with screen elements, goal, step count, stuck hints
 *  3. Call LLM via provider
 *  4. Parse response as ActionDecision
 *  5. If action is "done", stop
 *  6. Map action to WebSocket command and send to device
 *  7. Notify dashboard subscribers of each step
 *  8. Repeat until done or maxSteps reached
 */

import { sessions } from "../ws/sessions.js";
import {
  getLlmProvider,
  getSystemPrompt,
  buildDynamicPrompt,
  parseJsonResponse,
  type LLMConfig,
} from "./llm.js";
import { formatAppHints } from "./hints.js";
import { isSkillAction, executeSkill } from "./skills.js";
import { createStuckDetector } from "./stuck.js";
import { db } from "../db.js";
import { agentSession, agentStep, device as deviceTable } from "../schema.js";
import { eq } from "drizzle-orm";
import type { UIElement, ActionDecision } from "@droidclaw/shared";

// ─── Public Types ───────────────────────────────────────────────

export interface AgentLoopOptions {
  deviceId: string;
  /** Persistent device ID from DB (for FK references) */
  persistentDeviceId?: string;
  userId: string;
  goal: string;
  /** Original goal before preprocessing (if different from goal) */
  originalGoal?: string;
  llmConfig: LLMConfig;
  maxSteps?: number;
  /** If true, use dynamic prompts instead of mega-prompt (pipeline mode) */
  pipelineMode?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  onStep?: (step: AgentStep) => void;
  onComplete?: (result: AgentResult) => void;
}

export interface AgentStep {
  stepNumber: number;
  action: ActionDecision;
  reasoning: string;
  screenHash: string;
}

export interface AgentResult {
  success: boolean;
  stepsUsed: number;
  sessionId: string;
}

// ─── Screen Hash ────────────────────────────────────────────────

/**
 * Compute a screen hash for stuck detection.
 * Same algorithm as src/sanitizer.ts computeScreenHash().
 */
function computeScreenHash(elements: UIElement[]): string {
  const parts = elements.map(
    (e) =>
      `${e.id}|${e.text}|${e.center[0]},${e.center[1]}|${e.enabled}|${e.checked}`
  );
  return parts.join(";");
}

// ─── Screen Diffing ─────────────────────────────────────────────

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

// ─── Action → WebSocket Command Mapping ─────────────────────────

/**
 * Maps an ActionDecision to a WebSocket command object for the device.
 * The device companion app receives these and executes the corresponding
 * ADB/accessibility action.
 *
 * @param screenWidth  Device screen width in px (from DeviceInfo)
 * @param screenHeight Device screen height in px (from DeviceInfo)
 */
function actionToCommand(
  action: ActionDecision,
  screenWidth = 1080,
  screenHeight = 2400
): Record<string, unknown> {
  switch (action.action) {
    case "tap":
      return {
        type: "tap",
        x: action.coordinates?.[0],
        y: action.coordinates?.[1],
      };

    case "type":
      return { type: "type", text: action.text ?? "" };

    case "enter":
      return { type: "enter" };

    case "back":
      return { type: "back" };

    case "home":
      return { type: "home" };

    case "swipe":
    case "scroll": {
      // Compute swipe coordinates proportionally from device screen size
      const cx = Math.round(screenWidth * 0.5);
      const cy = Math.round(screenHeight * 0.5);
      const topY = Math.round(screenHeight * 0.167);
      const bottomY = Math.round(screenHeight * 0.667);
      const leftX = Math.round(screenWidth * 0.167);
      const rightX = Math.round(screenWidth * 0.833);

      const dir = action.direction ?? "down";
      let x1 = cx, y1 = bottomY, x2 = cx, y2 = topY;
      if (dir === "up") {
        y1 = topY; y2 = bottomY; // swipe from top to bottom = scroll up
      } else if (dir === "left") {
        x1 = rightX; y1 = cy; x2 = leftX; y2 = cy;
      } else if (dir === "right") {
        x1 = leftX; y1 = cy; x2 = rightX; y2 = cy;
      }
      // dir === "down" uses defaults: swipe from bottom to top = scroll down
      return { type: "swipe", x1, y1, x2, y2 };
    }

    case "longpress":
      return {
        type: "longpress",
        x: action.coordinates?.[0],
        y: action.coordinates?.[1],
      };

    case "launch":
      return {
        type: "launch",
        packageName: action.package ?? "",
        intentUri: action.uri,
        intentExtras: action.extras,
      };

    case "clear":
      return { type: "clear" };

    case "clipboard_set":
      return { type: "clipboard_set", text: action.text ?? "" };

    case "clipboard_get":
      return { type: "clipboard_get" };

    case "paste":
      return { type: "paste" };

    case "open_url":
      return { type: "open_url", url: action.url ?? "" };

    case "switch_app":
      return { type: "switch_app", packageName: action.package ?? "" };

    case "notifications":
      return { type: "notifications" };

    case "keyevent":
      return { type: "keyevent", code: action.code ?? 0 };

    case "open_settings":
      return { type: "open_settings", setting: action.setting };

    case "wait":
      return { type: "wait", duration: 2000 };

    case "intent":
      return {
        type: "intent",
        intentAction: action.intentAction,
        intentUri: action.uri,
        intentType: action.intentType,
        intentExtras: action.extras,
        packageName: action.package,
      };

    case "done":
      return { type: "done" };

    default:
      // Pass through unknown actions -- the device can decide what to do
      return { type: action.action };
  }
}

// ─── Main Agent Loop ────────────────────────────────────────────

export async function runAgentLoop(
  options: AgentLoopOptions
): Promise<AgentResult> {
  const {
    deviceId,
    persistentDeviceId,
    userId,
    goal,
    originalGoal,
    llmConfig,
    maxSteps = 30,
    signal,
    onStep,
    onComplete,
  } = options;

  const sessionId = crypto.randomUUID();
  const llm = getLlmProvider(llmConfig);
  const stuck = createStuckDetector();

  // Use legacy prompt if not in pipeline mode (backward compat)
  const useDynamicPrompt = options.pipelineMode ?? false;
  const legacySystemPrompt = useDynamicPrompt ? "" : getSystemPrompt();

  let prevElements: UIElement[] = [];
  let lastScreenHash = "";
  let stuckCount = 0;
  const recentActions: string[] = [];
  let lastActionFeedback = "";
  const actionHistory: string[] = []; // Human-readable log of recent actions

  // Fetch installed apps from device metadata for LLM context
  let installedAppsContext = "";
  if (persistentDeviceId) {
    try {
      const rows = await db
        .select({ info: deviceTable.deviceInfo })
        .from(deviceTable)
        .where(eq(deviceTable.id, persistentDeviceId))
        .limit(1);
      const info = rows[0]?.info as Record<string, unknown> | null;
      const apps = info?.installedApps as Array<{ packageName: string; label: string; intents?: string[] }> | undefined;
      if (apps && apps.length > 0) {
        // Build app list with intent capabilities
        const appLines = apps.map((a) => {
          const intents = a.intents?.length ? ` [${a.intents.join(", ")}]` : "";
          return `  ${a.label}: ${a.packageName}${intents}`;
        });
        installedAppsContext =
          `\nINSTALLED_APPS (use exact packageName for "launch", use intents in [] for "intent" action):\n` +
          appLines.join("\n") +
          "\n";
      }
    } catch {
      // Non-critical — continue without apps context
    }
  }

  // Persist session to DB
  if (persistentDeviceId) {
    try {
      await db.insert(agentSession).values({
        id: sessionId,
        userId,
        deviceId: persistentDeviceId,
        goal: originalGoal ?? goal,
        status: "running",
        stepsUsed: 0,
      });
    } catch (err) {
      console.error(`[Agent ${sessionId}] Failed to create DB session: ${err}`);
    }
  }

  // Notify dashboard that a goal has started
  sessions.notifyDashboard(userId, {
    type: "goal_started",
    sessionId,
    goal: originalGoal ?? goal,
    deviceId: persistentDeviceId ?? deviceId,
  });

  // Get device screen dimensions for accurate swipe coordinates
  const connectedDevice = sessions.getDevice(deviceId);
  const screenWidth = connectedDevice?.deviceInfo?.screenWidth ?? 1080;
  const screenHeight = connectedDevice?.deviceInfo?.screenHeight ?? 2400;
  console.log(`[Agent ${sessionId}] Device screen: ${screenWidth}x${screenHeight}`);

  let stepsUsed = 0;
  let success = false;

  try {
    for (let step = 0; step < maxSteps; step++) {
      // Check for cancellation
      if (signal?.aborted) {
        console.log(`[Agent ${sessionId}] Stopped by user at step ${step + 1}`);
        break;
      }

      stepsUsed = step + 1;

      // ── 1. Get screen state from device ─────────────────────
      const screenResponse = (await sessions.sendCommand(deviceId, {
        type: "get_screen",
      })) as {
        elements?: UIElement[];
        screenshot?: string;
        packageName?: string;
      };

      const elements = screenResponse.elements ?? [];
      const screenshot = screenResponse.screenshot;
      const packageName = screenResponse.packageName;
      const screenHash = computeScreenHash(elements);

      // ── 2. Screen diff: detect stuck loops ──────────────────
      let diffContext = "";
      if (step > 0) {
        const diff = diffScreenState(prevElements, elements);

        if (!diff.changed) {
          stuckCount++;
          if (stuckCount >= 3) {
            diffContext += `\nWARNING: You have been stuck for ${stuckCount} steps. The screen is NOT changing.`;
            diffContext +=
              "\nYour plan is NOT working. You MUST create a completely NEW plan with a different approach.";
          }
        } else {
          stuckCount = 0;
        }

        diffContext = `\n\nSCREEN_CHANGE: ${diff.summary}` + diffContext;
      }
      prevElements = elements;

      // Repetition detection (persists across screen changes)
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
            `This action is clearly NOT working -- do NOT attempt it again.`;
        }
      }

      // Drift detection (navigation spam)
      if (recentActions.length >= 4) {
        const navigationActions = new Set([
          "swipe",
          "scroll",
          "back",
          "home",
          "wait",
        ]);
        const navCount = recentActions
          .slice(-5)
          .filter((a) => navigationActions.has(a.split("(")[0])).length;
        if (navCount >= 4) {
          diffContext +=
            `\nDRIFT_WARNING: Your last ${navCount} actions were all navigation/waiting with no direct interaction. ` +
            `STOP scrolling/navigating and take a DIRECT action: tap a specific button, use "type", or use "clipboard_set".`;
        }
      }

      // ── 3. Vision context ───────────────────────────────────
      let visionContext = "";
      let useScreenshot = false;

      if (elements.length === 0) {
        visionContext =
          "\n\nVISION_FALLBACK: The accessibility tree returned NO elements. " +
          "A screenshot has been captured. The screen likely contains custom-drawn " +
          "content (game, WebView, or Flutter). Try using coordinate-based taps on " +
          "common UI positions, or use 'back'/'home' to navigate away.";
        useScreenshot = true;
      } else if (stuckCount >= 2) {
        visionContext =
          "\n\nVISION_ASSIST: You have been stuck -- a screenshot is attached. " +
          "Use the screenshot to VISUALLY identify the correct field positions, " +
          "buttons, and layout. The accessibility tree may be misleading.";
        useScreenshot = true;
      } else if (elements.length < 3) {
        // Very few elements -- vision may help
        useScreenshot = true;
      }

      // ── 4. Build prompts ──────────────────────────────────────
      let systemPrompt: string;
      if (useDynamicPrompt) {
        const hasEditableFields = elements.some((e) => e.editable);
        const hasScrollable = elements.some((e) => e.scrollable);
        const appHintsStr = packageName ? formatAppHints(packageName) : "";

        systemPrompt = buildDynamicPrompt({
          hasEditableFields,
          hasScrollable,
          foregroundApp: packageName,
          appHints: appHintsStr,
          isStuck: stuck.isStuck(),
        });
      } else {
        systemPrompt = legacySystemPrompt;
      }

      const foregroundLine = packageName
        ? `FOREGROUND_APP: ${packageName}\n\n`
        : "";
      const actionFeedbackLine = lastActionFeedback
        ? `LAST_ACTION_RESULT: ${lastActionFeedback}\n\n`
        : "";

      // Include recent action history so LLM knows what it already did
      const historyContext = actionHistory.length > 0
        ? `RECENT_ACTIONS (what you already did — do NOT repeat completed work):\n${actionHistory.map((h) => `  ${h}`).join("\n")}\n\n`
        : "";

      let userPrompt =
        `GOAL: ${goal}\n\n` +
        `STEP: ${step + 1}/${maxSteps}\n\n` +
        (useDynamicPrompt ? "" : installedAppsContext) +
        foregroundLine +
        actionFeedbackLine +
        historyContext +
        `SCREEN_CONTEXT:\n${JSON.stringify(elements, null, 2)}` +
        diffContext +
        visionContext;

      // Add stuck recovery hint from detector (only for legacy mode; dynamic prompt handles it)
      if (!useDynamicPrompt && stuck.isStuck()) {
        userPrompt += "\n\n" + stuck.getRecoveryHint();
      }

      lastScreenHash = screenHash;

      // ── 5. Call LLM ─────────────────────────────────────────
      let rawResponse: string;
      try {
        rawResponse = await llm.getAction(
          systemPrompt,
          userPrompt,
          useScreenshot ? screenshot : undefined,
          signal
        );
      } catch (err) {
        if (signal?.aborted) break;
        console.error(
          `[Agent ${sessionId}] LLM error at step ${step + 1}: ${(err as Error).message}`
        );
        stuck.recordAction("llm_error", screenHash);
        lastActionFeedback = `llm_error -> FAILED: ${(err as Error).message}`;
        continue;
      }

      // ── 6. Parse response (retry once on failure) ─────────
      let parsed = parseJsonResponse(rawResponse);
      if (!parsed || !parsed.action) {
        console.warn(
          `[Agent ${sessionId}] Parse failed at step ${step + 1}, retrying LLM. Raw: ${rawResponse.slice(0, 200)}`
        );
        try {
          rawResponse = await llm.getAction(
            systemPrompt,
            userPrompt + "\n\nIMPORTANT: Your previous response was not valid JSON. You MUST respond with ONLY a valid JSON object.",
            useScreenshot ? screenshot : undefined,
            signal
          );
          parsed = parseJsonResponse(rawResponse);
        } catch {
          // retry failed, fall through
        }
      }
      if (!parsed || !parsed.action) {
        console.error(
          `[Agent ${sessionId}] Failed to parse LLM response at step ${step + 1}. Raw: ${rawResponse.slice(0, 300)}`
        );
        stuck.recordAction("parse_error", screenHash);
        lastActionFeedback = "parse_error -> FAILED: Could not parse LLM response";
        continue;
      }

      const action = parsed as unknown as ActionDecision;

      // Track action for stuck detection
      const actionSig = action.coordinates
        ? `${action.action}(${action.coordinates.join(",")})`
        : action.action;
      stuck.recordAction(actionSig, screenHash);
      recentActions.push(actionSig);
      if (recentActions.length > 8) recentActions.shift();

      // Build human-readable history entry for LLM context
      const historyParts = [`Step ${step + 1}: ${actionSig}`];
      if (action.text) historyParts.push(`text="${action.text}"`);
      if (action.reason) historyParts.push(`— ${action.reason}`);
      actionHistory.push(historyParts.join(" "));
      if (actionHistory.length > 5) actionHistory.shift();

      // ── 7. Log + Done check ────────────────────────────────
      const reason = action.reason ?? "";
      console.log(`[Agent ${sessionId}] Step ${step + 1}: ${actionSig} — ${reason}`);

      if (action.action === "done") {
        success = true;
        break;
      }

      // ── 8. Notify dashboard ─────────────────────────────────
      const stepData: AgentStep = {
        stepNumber: step + 1,
        action,
        reasoning: action.reason ?? "",
        screenHash,
      };
      onStep?.(stepData);

      sessions.notifyDashboard(userId, {
        type: "step",
        sessionId,
        step: step + 1,
        action: action as unknown as Record<string, unknown>,
        reasoning: action.reason ?? "",
        screenHash,
      });

      // ── 8b. Persist step to DB ────────────────────────────────
      const stepId = crypto.randomUUID();
      if (persistentDeviceId) {
        db.insert(agentStep)
          .values({
            id: stepId,
            sessionId,
            stepNumber: step + 1,
            screenHash,
            action: action as unknown as Record<string, unknown>,
            reasoning: action.reason ?? "",
          })
          .catch((err) =>
            console.error(`[Agent ${sessionId}] Failed to save step ${step + 1}: ${err}`)
          );
      }

      // ── 9. Execute on device (skills intercepted server-side) ──
      try {
        if (isSkillAction(action.action)) {
          // Multi-step skill: run server-side using WebSocket primitives
          const skillResult = await executeSkill(
            deviceId,
            action as unknown as Record<string, unknown> & { action: string },
            elements,
            screenWidth,
            screenHeight
          );
          lastActionFeedback = `${actionSig} -> ${skillResult.success ? "OK" : "FAILED"}: ${skillResult.message}`;
        } else {
          // Regular action: map to WebSocket command and send to device
          const command = actionToCommand(action, screenWidth, screenHeight);
          const result = (await sessions.sendCommand(deviceId, command)) as {
            success?: boolean;
            error?: string;
            data?: string;
          };
          const resultSuccess = result.success !== false;
          lastActionFeedback = `${actionSig} -> ${resultSuccess ? "OK" : "FAILED"}: ${result.error ?? result.data ?? "completed"}`;
        }
        console.log(`[Agent ${sessionId}] Step ${step + 1} result: ${lastActionFeedback}`);
        // Append result to last history entry
        if (actionHistory.length > 0) {
          const ok = lastActionFeedback.includes("-> OK");
          actionHistory[actionHistory.length - 1] += ` → ${ok ? "OK" : "FAILED"}`;
        }
        // Update step result in DB
        if (persistentDeviceId) {
          db.update(agentStep).set({ result: lastActionFeedback }).where(eq(agentStep.id, stepId))
            .catch(() => {});
        }
      } catch (err) {
        lastActionFeedback = `${actionSig} -> FAILED: ${(err as Error).message}`;
        console.log(`[Agent ${sessionId}] Step ${step + 1} result: ${lastActionFeedback}`);
        if (persistentDeviceId) {
          db.update(agentStep).set({ result: lastActionFeedback }).where(eq(agentStep.id, stepId))
            .catch(() => {});
        }
        console.error(
          `[Agent ${sessionId}] Command error at step ${step + 1}: ${(err as Error).message}`
        );
      }

      // ── 10. Brief pause for UI to settle ────────────────────
      if (signal?.aborted) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (error) {
    console.error(`[Agent ${sessionId}] Loop error: ${error}`);
  }

  const result: AgentResult = { success, stepsUsed, sessionId };

  // Update session in DB
  if (persistentDeviceId) {
    db.update(agentSession)
      .set({
        status: success ? "completed" : "failed",
        stepsUsed,
        completedAt: new Date(),
      })
      .where(eq(agentSession.id, sessionId))
      .catch((err) =>
        console.error(`[Agent ${sessionId}] Failed to update DB session: ${err}`)
      );
  }

  sessions.notifyDashboard(userId, {
    type: "goal_completed",
    sessionId,
    success,
    stepsUsed,
  });

  onComplete?.(result);
  return result;
}

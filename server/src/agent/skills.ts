/**
 * Server-side multi-step skills for the DroidClaw agent loop.
 *
 * These replace 3-8 LLM calls with deterministic server-side logic.
 * Each skill uses sessions.sendCommand() to interact with the device
 * via WebSocket — no direct ADB needed.
 *
 * Skills:
 *   copy_visible_text — Extract text from screen elements, set clipboard
 *   find_and_tap     — Search elements by text, scroll if needed, tap
 *   submit_message   — Find Send/Submit button and tap it
 *   read_screen      — Scroll through page, collect all text, set clipboard
 *   wait_for_content — Poll for new content to appear
 *   compose_email    — Launch mailto: intent, paste body
 */

import { sessions } from "../ws/sessions.js";
import type { UIElement } from "@droidclaw/shared";

// ─── Types ──────────────────────────────────────────────────────

export interface SkillResult {
  success: boolean;
  message: string;
  data?: string;
}

interface SkillAction {
  action: string;
  query?: string;
  text?: string;
  [key: string]: unknown;
}

// ─── Skill Registry ─────────────────────────────────────────────

const SKILL_ACTIONS = new Set([
  "copy_visible_text",
  "find_and_tap",
  "submit_message",
  "read_screen",
  "wait_for_content",
  "compose_email",
]);

export function isSkillAction(action: string): boolean {
  return SKILL_ACTIONS.has(action);
}

/**
 * Execute a multi-step skill server-side.
 * Returns null if the action is not a skill (caller should handle normally).
 */
export async function executeSkill(
  deviceId: string,
  action: SkillAction,
  currentElements: UIElement[]
): Promise<SkillResult> {
  switch (action.action) {
    case "copy_visible_text":
      return copyVisibleText(deviceId, action, currentElements);
    case "find_and_tap":
      return findAndTap(deviceId, action, currentElements);
    case "submit_message":
      return submitMessage(deviceId, currentElements);
    case "read_screen":
      return readScreen(deviceId, currentElements);
    case "wait_for_content":
      return waitForContent(deviceId, currentElements);
    case "compose_email":
      return composeEmail(deviceId, action);
    default:
      return { success: false, message: `Unknown skill: ${action.action}` };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

async function getScreen(
  deviceId: string
): Promise<{ elements: UIElement[]; packageName?: string }> {
  try {
    const res = (await sessions.sendCommand(deviceId, {
      type: "get_screen",
    })) as { elements?: UIElement[]; packageName?: string };
    return { elements: res.elements ?? [], packageName: res.packageName };
  } catch {
    return { elements: [] };
  }
}

async function tap(deviceId: string, x: number, y: number): Promise<void> {
  await sessions.sendCommand(deviceId, { type: "tap", x, y });
}

async function swipeDown(deviceId: string): Promise<void> {
  // Scroll down = swipe from bottom to top (1080px wide screen defaults)
  await sessions.sendCommand(deviceId, {
    type: "swipe",
    x1: 540, y1: 1600, x2: 540, y2: 400,
  });
}

async function clipboardSet(deviceId: string, text: string): Promise<void> {
  await sessions.sendCommand(deviceId, { type: "clipboard_set", text });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function findMatch(
  elements: UIElement[],
  queryLower: string
): UIElement | null {
  const matches = elements.filter(
    (el) => el.text && el.text.toLowerCase().includes(queryLower)
  );
  if (matches.length === 0) return null;

  const scored = matches.map((el) => {
    let score = 0;
    if (el.enabled) score += 10;
    if (el.clickable || el.longClickable) score += 5;
    if (el.text.toLowerCase() === queryLower) score += 20;
    else score += 5;
    return { el, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].el;
}

// ─── Skill: copy_visible_text ───────────────────────────────────

async function copyVisibleText(
  deviceId: string,
  action: SkillAction,
  elements: UIElement[]
): Promise<SkillResult> {
  // 1. Filter for readable text elements
  let textElements = elements.filter((el) => el.text && el.action === "read");

  // 2. If query provided, filter to matching elements
  if (action.query) {
    const query = action.query.toLowerCase();
    textElements = textElements.filter((el) =>
      el.text.toLowerCase().includes(query)
    );
  }

  // Fallback: include all elements with text
  if (textElements.length === 0) {
    textElements = elements.filter((el) => el.text);
    if (action.query) {
      const query = action.query.toLowerCase();
      textElements = textElements.filter((el) =>
        el.text.toLowerCase().includes(query)
      );
    }
  }

  if (textElements.length === 0) {
    return {
      success: false,
      message: action.query
        ? `No text matching "${action.query}" found on screen`
        : "No readable text found on screen",
    };
  }

  // 3. Sort by vertical position (top to bottom)
  textElements.sort((a, b) => a.center[1] - b.center[1]);

  // 4. Concatenate and set clipboard
  const combinedText = textElements.map((el) => el.text).join("\n");
  await clipboardSet(deviceId, combinedText);

  return {
    success: true,
    message: `Copied ${textElements.length} text elements to clipboard (${combinedText.length} chars)`,
    data: combinedText.slice(0, 200),
  };
}

// ─── Skill: find_and_tap ────────────────────────────────────────

async function findAndTap(
  deviceId: string,
  action: SkillAction,
  elements: UIElement[]
): Promise<SkillResult> {
  const query = action.query;
  if (!query) {
    return { success: false, message: "find_and_tap requires a query" };
  }

  const queryLower = query.toLowerCase();

  // 1. Check current screen
  let best = findMatch(elements, queryLower);

  // 2. If not found, scroll down and re-check (up to 8 scrolls)
  if (!best) {
    const maxScrolls = 8;
    for (let i = 0; i < maxScrolls; i++) {
      console.log(
        `[Skill] find_and_tap: "${query}" not visible, scrolling down (${i + 1}/${maxScrolls})`
      );
      await swipeDown(deviceId);
      await sleep(1200);

      const { elements: freshElements } = await getScreen(deviceId);
      best = findMatch(freshElements, queryLower);
      if (best) {
        console.log(
          `[Skill] find_and_tap: Found "${query}" after ${i + 1} scroll(s)`
        );
        break;
      }
    }
  }

  if (!best) {
    const available = elements
      .filter((el) => el.text)
      .map((el) => el.text)
      .slice(0, 10);
    return {
      success: false,
      message: `No element matching "${query}" found after scrolling. Visible: ${available.join(", ")}`,
    };
  }

  // 3. Tap it
  const [x, y] = best.center;
  console.log(`[Skill] find_and_tap: Tapping "${best.text}" at (${x}, ${y})`);
  await tap(deviceId, x, y);

  return {
    success: true,
    message: `Found and tapped "${best.text}" at (${x}, ${y})`,
    data: best.text,
  };
}

// ─── Skill: submit_message ──────────────────────────────────────

const SEND_BUTTON_PATTERN = /send|submit|post|arrow|paper.?plane/i;

async function submitMessage(
  deviceId: string,
  elements: UIElement[]
): Promise<SkillResult> {
  // 1. Search for Send/Submit button by text or ID
  let candidates = elements.filter(
    (el) =>
      el.enabled &&
      (el.clickable || el.action === "tap") &&
      (SEND_BUTTON_PATTERN.test(el.text) || SEND_BUTTON_PATTERN.test(el.id))
  );

  // 2. Fallback: clickable elements in bottom 20%, prefer rightmost
  if (candidates.length === 0) {
    const clickable = elements
      .filter((el) => el.enabled && el.clickable)
      .sort((a, b) => b.center[1] - a.center[1]);

    if (clickable.length > 0) {
      const maxY = clickable[0].center[1];
      const threshold = maxY * 0.8;
      candidates = clickable.filter((el) => el.center[1] >= threshold);
      candidates.sort((a, b) => b.center[0] - a.center[0]);
    }
  }

  if (candidates.length === 0) {
    return {
      success: false,
      message: "Could not find a Send/Submit button on screen",
    };
  }

  // 3. Tap the best match
  const target = candidates[0];
  const [x, y] = target.center;
  console.log(
    `[Skill] submit_message: Tapping "${target.text}" at (${x}, ${y})`
  );
  await tap(deviceId, x, y);

  // 4. Wait for response
  await sleep(4000);

  // 5. Check for new content
  const { elements: newElements } = await getScreen(deviceId);
  const originalTexts = new Set(
    elements.map((el) => el.text).filter(Boolean)
  );
  const newTexts = newElements
    .map((el) => el.text)
    .filter((t) => t && !originalTexts.has(t));

  if (newTexts.length > 0) {
    const summary = newTexts.slice(0, 3).join("; ");
    return {
      success: true,
      message: `Tapped "${target.text}" — new content: ${summary}`,
      data: summary,
    };
  }

  return {
    success: true,
    message: `Tapped "${target.text}" at (${x}, ${y}). No new content yet — may still be loading.`,
  };
}

// ─── Skill: read_screen ─────────────────────────────────────────

async function readScreen(
  deviceId: string,
  elements: UIElement[]
): Promise<SkillResult> {
  const allTexts: string[] = [];
  const seenTexts = new Set<string>();

  function collectTexts(els: UIElement[]): number {
    let added = 0;
    for (const el of els) {
      if (el.text && !seenTexts.has(el.text)) {
        seenTexts.add(el.text);
        allTexts.push(el.text);
        added++;
      }
    }
    return added;
  }

  // 1. Collect from initial screen
  collectTexts(elements);

  // 2. Scroll down and collect until no new content
  const maxScrolls = 5;
  let scrollsDone = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await swipeDown(deviceId);
    await sleep(1200);
    scrollsDone++;

    const { elements: newElements } = await getScreen(deviceId);
    const added = collectTexts(newElements);
    console.log(
      `[Skill] read_screen: Scroll ${scrollsDone} — found ${added} new text elements`
    );

    if (added === 0) break;
  }

  const combinedText = allTexts.join("\n");

  // 3. Copy to clipboard
  if (combinedText.length > 0) {
    await clipboardSet(deviceId, combinedText);
  }

  return {
    success: true,
    message: `Read ${allTexts.length} text elements across ${scrollsDone} scrolls (${combinedText.length} chars), copied to clipboard`,
    data: combinedText.slice(0, 300),
  };
}

// ─── Skill: wait_for_content ────────────────────────────────────

async function waitForContent(
  deviceId: string,
  elements: UIElement[]
): Promise<SkillResult> {
  const originalTexts = new Set(
    elements.map((el) => el.text).filter(Boolean)
  );

  // Poll up to 5 times (3s intervals = 15s max)
  for (let i = 0; i < 5; i++) {
    console.log(
      `[Skill] wait_for_content: Waiting 3s... (attempt ${i + 1}/5)`
    );
    await sleep(3000);

    const { elements: newElements } = await getScreen(deviceId);
    const newTexts = newElements
      .map((el) => el.text)
      .filter((t) => t && !originalTexts.has(t));

    const totalNewChars = newTexts.reduce((sum, t) => sum + t.length, 0);
    if (totalNewChars > 20) {
      const summary = newTexts.slice(0, 5).join("; ");
      return {
        success: true,
        message: `New content appeared after ${(i + 1) * 3}s: ${summary}`,
        data: summary,
      };
    }
  }

  return {
    success: false,
    message: "No new content appeared after 15s",
  };
}

// ─── Skill: compose_email ───────────────────────────────────────

async function composeEmail(
  deviceId: string,
  action: SkillAction
): Promise<SkillResult> {
  const emailAddress = action.query;
  const bodyContent = action.text;

  if (!emailAddress) {
    return {
      success: false,
      message:
        'compose_email requires query (email address). Example: {"action": "compose_email", "query": "user@example.com"}',
    };
  }

  // 1. Launch mailto: intent
  console.log(`[Skill] compose_email: Launching mailto:${emailAddress}`);
  await sessions.sendCommand(deviceId, {
    type: "intent",
    intentAction: "android.intent.action.SENDTO",
    intentUri: `mailto:${emailAddress}`,
  });
  await sleep(2500);

  // 2. Find body field and paste content
  const { elements } = await getScreen(deviceId);
  const editables = elements
    .filter((el) => el.editable && el.enabled)
    .sort((a, b) => a.center[1] - b.center[1]);

  if (editables.length === 0) {
    return {
      success: false,
      message: "Launched email compose but no editable fields appeared",
    };
  }

  // Body is typically the last/largest editable field
  const bodyField = editables[editables.length - 1];
  const [bx, by] = bodyField.center;
  console.log(`[Skill] compose_email: Tapping Body field at (${bx}, ${by})`);
  await tap(deviceId, bx, by);
  await sleep(300);

  // Set clipboard with body content and paste
  if (bodyContent) {
    await clipboardSet(deviceId, bodyContent);
    await sleep(200);
  }
  await sessions.sendCommand(deviceId, { type: "paste" });

  return {
    success: true,
    message: `Email compose opened to ${emailAddress}, body pasted`,
  };
}

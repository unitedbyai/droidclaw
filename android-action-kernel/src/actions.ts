/**
 * Action execution module for Android Action Kernel.
 * Handles all ADB commands for interacting with Android devices.
 *
 * Supported actions:
 *   tap, type, enter, swipe, home, back, wait, done,
 *   longpress, screenshot, launch, clear, clipboard_get, clipboard_set, shell
 */

import { Config } from "./config.js";
import {
  KEYCODE_ENTER,
  KEYCODE_HOME,
  KEYCODE_BACK,
  KEYCODE_DEL,
  KEYCODE_MOVE_HOME,
  KEYCODE_MOVE_END,
  SWIPE_COORDS,
  SWIPE_DURATION_MS,
  LONG_PRESS_DURATION_MS,
  DEVICE_SCREENSHOT_PATH,
  LOCAL_SCREENSHOT_PATH,
  computeSwipeCoords,
} from "./constants.js";

export interface ActionDecision {
  action: string;
  coordinates?: [number, number];
  text?: string;
  direction?: string;
  reason?: string;
  // launch action
  package?: string;
  activity?: string;
  uri?: string;
  extras?: Record<string, string>;
  // shell action
  command?: string;
  // screenshot action
  filename?: string;
  // planning fields (Phase 4B)
  think?: string;
  plan?: string[];
  planProgress?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  data?: string;
}

/**
 * Executes a shell command via ADB with retry support.
 */
export function runAdbCommand(command: string[], retries = Config.MAX_RETRIES): string {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = Bun.spawnSync([Config.ADB_PATH, ...command], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = result.stdout.toString().trim();
    const stderr = result.stderr.toString().trim();

    if (stderr && stderr.toLowerCase().includes("error")) {
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`ADB Error (attempt ${attempt + 1}/${retries + 1}): ${stderr}`);
        console.log(`Retrying in ${delay / 1000}s...`);
        Bun.sleepSync(delay);
        continue;
      }
      console.log(`ADB Error (all retries exhausted): ${stderr}`);
    }

    return stdout;
  }

  return "";
}

// ===========================================
// Device Intelligence (Phase 1)
// ===========================================

/** Module-level dynamic swipe coords, set by initDeviceContext() */
let dynamicSwipeCoords: Record<string, [number, number, number, number]> | null = null;

/**
 * Detects the connected device's screen resolution via ADB.
 * Returns [width, height] or null on failure.
 */
export function getScreenResolution(): [number, number] | null {
  try {
    const output = runAdbCommand(["shell", "wm", "size"]);
    // Try "Override size:" first, then "Physical size:"
    const overrideMatch = output.match(/Override size:\s*(\d+)x(\d+)/);
    if (overrideMatch) {
      return [parseInt(overrideMatch[1], 10), parseInt(overrideMatch[2], 10)];
    }
    const physicalMatch = output.match(/Physical size:\s*(\d+)x(\d+)/);
    if (physicalMatch) {
      return [parseInt(physicalMatch[1], 10), parseInt(physicalMatch[2], 10)];
    }
  } catch {
    console.log("Warning: Could not detect screen resolution.");
  }
  return null;
}

/**
 * Detects the currently running foreground app.
 * Returns "package/activity" or null on failure.
 */
export function getForegroundApp(): string | null {
  try {
    const output = runAdbCommand([
      "shell", "dumpsys", "activity", "activities",
    ]);
    // Match mResumedActivity line
    const match = output.match(/mResumedActivity.*?(\S+\/\S+)/);
    if (match) {
      return match[1].replace("}", "");
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Stores dynamic swipe coordinates based on detected resolution.
 * Must be called once at startup.
 */
export function initDeviceContext(resolution: [number, number]): void {
  dynamicSwipeCoords = computeSwipeCoords(resolution[0], resolution[1]);
}

/** Returns dynamic swipe coords if set, otherwise falls back to hardcoded defaults. */
function getSwipeCoords(): Record<string, [number, number, number, number]> {
  return dynamicSwipeCoords ?? SWIPE_COORDS;
}

/**
 * Executes the action decided by the LLM. Returns a result for the kernel to track.
 */
export function executeAction(action: ActionDecision): ActionResult {
  switch (action.action) {
    case "tap":
      return executeTap(action);
    case "type":
      return executeType(action);
    case "enter":
      return executeEnter();
    case "swipe":
      return executeSwipe(action);
    case "home":
      return executeHome();
    case "back":
      return executeBack();
    case "wait":
      return executeWait();
    case "done":
      return executeDone(action);
    case "longpress":
      return executeLongPress(action);
    case "screenshot":
      return executeScreenshot(action);
    case "launch":
      return executeLaunch(action);
    case "clear":
      return executeClear();
    case "clipboard_get":
      return executeClipboardGet();
    case "clipboard_set":
      return executeClipboardSet(action);
    case "shell":
      return executeShell(action);
    default:
      console.log(`Warning: Unknown action: ${action.action}`);
      return { success: false, message: `Unknown action: ${action.action}` };
  }
}

// ===========================================
// Original actions (enhanced)
// ===========================================

function executeTap(action: ActionDecision): ActionResult {
  const [x, y] = action.coordinates ?? [0, 0];
  console.log(`Tapping: (${x}, ${y})`);
  runAdbCommand(["shell", "input", "tap", String(x), String(y)]);
  return { success: true, message: `Tapped (${x}, ${y})` };
}

function executeType(action: ActionDecision): ActionResult {
  const text = action.text ?? "";
  if (!text) return { success: false, message: "No text to type" };
  // ADB requires %s for spaces, escape special shell characters
  const escapedText = text
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("'", "\\'")
    .replaceAll(" ", "%s")
    .replaceAll("&", "\\&")
    .replaceAll("|", "\\|")
    .replaceAll(";", "\\;")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("<", "\\<")
    .replaceAll(">", "\\>");
  console.log(`Typing: ${text}`);
  runAdbCommand(["shell", "input", "text", escapedText]);
  return { success: true, message: `Typed "${text}"` };
}

function executeEnter(): ActionResult {
  console.log("Pressing Enter");
  runAdbCommand(["shell", "input", "keyevent", KEYCODE_ENTER]);
  return { success: true, message: "Pressed Enter" };
}

function executeSwipe(action: ActionDecision): ActionResult {
  const direction = action.direction ?? "up";
  const swipeCoords = getSwipeCoords();
  const coords = swipeCoords[direction] ?? swipeCoords["up"];

  console.log(`Swiping ${direction}`);
  runAdbCommand([
    "shell", "input", "swipe",
    String(coords[0]), String(coords[1]),
    String(coords[2]), String(coords[3]),
    SWIPE_DURATION_MS,
  ]);
  return { success: true, message: `Swiped ${direction}` };
}

function executeHome(): ActionResult {
  console.log("Going Home");
  runAdbCommand(["shell", "input", "keyevent", KEYCODE_HOME]);
  return { success: true, message: "Went to home screen" };
}

function executeBack(): ActionResult {
  console.log("Going Back");
  runAdbCommand(["shell", "input", "keyevent", KEYCODE_BACK]);
  return { success: true, message: "Went back" };
}

function executeWait(): ActionResult {
  console.log("Waiting...");
  Bun.sleepSync(2000);
  return { success: true, message: "Waited 2s" };
}

function executeDone(action: ActionDecision): ActionResult {
  console.log(`Goal Achieved: ${action.reason ?? "Task complete"}`);
  return { success: true, message: "done" };
}

// ===========================================
// New actions
// ===========================================

/**
 * Long press at coordinates (opens context menus, triggers drag mode, etc.)
 */
function executeLongPress(action: ActionDecision): ActionResult {
  const [x, y] = action.coordinates ?? [0, 0];
  console.log(`Long pressing: (${x}, ${y})`);
  // A swipe from the same point to the same point with long duration = long press
  runAdbCommand([
    "shell", "input", "swipe",
    String(x), String(y), String(x), String(y),
    LONG_PRESS_DURATION_MS,
  ]);
  return { success: true, message: `Long pressed (${x}, ${y})` };
}

/**
 * Captures a screenshot and saves it locally.
 */
function executeScreenshot(action: ActionDecision): ActionResult {
  const filename = action.filename ?? LOCAL_SCREENSHOT_PATH;
  console.log(`Taking screenshot → ${filename}`);
  runAdbCommand(["shell", "screencap", "-p", DEVICE_SCREENSHOT_PATH]);
  runAdbCommand(["pull", DEVICE_SCREENSHOT_PATH, filename]);
  return { success: true, message: `Screenshot saved to ${filename}`, data: filename };
}

/**
 * Launches an app by package name, activity, or URI intent.
 *
 * Examples the LLM can produce:
 *   { action: "launch", package: "com.whatsapp" }
 *   { action: "launch", package: "com.whatsapp", activity: ".HomeActivity" }
 *   { action: "launch", uri: "https://maps.google.com/?q=pizza+near+me" }
 *   { action: "launch", package: "com.whatsapp", uri: "content://media/external/images/1",
 *     extras: { "android.intent.extra.TEXT": "Check this out" } }
 */
function executeLaunch(action: ActionDecision): ActionResult {
  const args: string[] = ["shell", "am", "start"];

  if (action.uri) {
    args.push("-a", "android.intent.action.VIEW");
    args.push("-d", action.uri);
  }

  if (action.package && action.activity) {
    args.push("-n", `${action.package}/${action.activity}`);
  } else if (action.package) {
    // Launch the default activity for the package
    const launchResult = runAdbCommand([
      "shell", "monkey", "-p", action.package, "-c",
      "android.intent.category.LAUNCHER", "1",
    ]);
    console.log(`Launching: ${action.package}`);
    return { success: true, message: `Launched ${action.package}`, data: launchResult };
  }

  // Attach intent extras
  if (action.extras) {
    for (const [key, value] of Object.entries(action.extras)) {
      args.push("--es", key, value);
    }
  }

  const label = action.package ?? action.uri ?? "intent";
  console.log(`Launching: ${label}`);
  const result = runAdbCommand(args);
  return { success: true, message: `Launched ${label}`, data: result };
}

/**
 * Clears the currently focused text field.
 * Selects all text then deletes it.
 */
function executeClear(): ActionResult {
  console.log("Clearing text field");
  // Move to end of field
  runAdbCommand(["shell", "input", "keyevent", KEYCODE_MOVE_END]);
  // Select all: Shift+Home
  runAdbCommand(["shell", "input", "keyevent", "--longpress", KEYCODE_MOVE_HOME]);
  // Delete selected text
  runAdbCommand(["shell", "input", "keyevent", KEYCODE_DEL]);
  return { success: true, message: "Cleared text field" };
}

/**
 * Reads the current clipboard contents.
 */
function executeClipboardGet(): ActionResult {
  console.log("Reading clipboard");
  // Use am broadcast to get clipboard via a helper or service log
  // On Android 10+, direct clipboard access via ADB is restricted.
  // Workaround: dump the clipboard service log
  const result = runAdbCommand(["shell", "cmd", "clipboard", "get-text"]);
  if (result) {
    console.log(`Clipboard: ${result.slice(0, 100)}`);
    return { success: true, message: `Clipboard: ${result}`, data: result };
  }
  // Fallback for older Android versions
  const fallback = runAdbCommand([
    "shell", "service", "call", "clipboard", "2", "i32", "1",
  ]);
  return { success: true, message: `Clipboard (raw): ${fallback}`, data: fallback };
}

/**
 * Sets the clipboard to the given text.
 */
function executeClipboardSet(action: ActionDecision): ActionResult {
  const text = action.text ?? "";
  if (!text) return { success: false, message: "No text to set on clipboard" };
  console.log(`Setting clipboard: ${text.slice(0, 50)}...`);
  runAdbCommand(["shell", "cmd", "clipboard", "set-text", text]);
  return { success: true, message: `Clipboard set to "${text.slice(0, 50)}"` };
}

/**
 * Runs an arbitrary ADB shell command. Use sparingly for edge cases.
 */
function executeShell(action: ActionDecision): ActionResult {
  const cmd = action.command ?? "";
  if (!cmd) return { success: false, message: "No command provided" };
  console.log(`Shell: ${cmd}`);
  const result = runAdbCommand(["shell", ...cmd.split(" ")]);
  return { success: true, message: `Shell output: ${result.slice(0, 200)}`, data: result };
}

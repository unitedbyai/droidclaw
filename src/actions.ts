/**
 * Action execution module for DroidClaw.
 * Handles all ADB commands for interacting with Android devices.
 *
 * Supported actions (28):
 *   tap, type, enter, swipe, home, back, wait, done,
 *   longpress, screenshot, launch, clear, clipboard_get, clipboard_set, paste, shell,
 *   submit_message, copy_visible_text, wait_for_content, find_and_tap, compose_email,
 *   open_url, switch_app, notifications, pull_file, push_file, keyevent, open_settings
 */

import { Config } from "./config.js";
import {
  KEYCODE_ENTER,
  KEYCODE_HOME,
  KEYCODE_BACK,
  KEYCODE_DEL,
  KEYCODE_MOVE_HOME,
  KEYCODE_MOVE_END,
  KEYCODE_PASTE,
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
  // multi-step action fields (Phase 6)
  skill?: string; // legacy: kept for backward compat, prefer action field directly
  query?: string; // email address for compose_email, search term for find_and_tap/copy_visible_text
  // open_url action
  url?: string;
  // pull_file action
  path?: string;
  // push_file action
  source?: string;
  dest?: string;
  // keyevent action
  code?: number;
  // open_settings action
  setting?: string;
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
export function getSwipeCoords(): Record<string, [number, number, number, number]> {
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
    case "paste":
      return executePaste(action);
    case "shell":
      return executeShell(action);
    case "scroll":
      return executeScroll(action);
    case "open_url":
      return executeOpenUrl(action);
    case "switch_app":
      return executeSwitchApp(action);
    case "notifications":
      return executeNotifications();
    case "pull_file":
      return executePullFile(action);
    case "push_file":
      return executePushFile(action);
    case "keyevent":
      return executeKeyevent(action);
    case "open_settings":
      return executeOpenSettings(action);
    default:
      console.log(`Warning: Unknown action: ${action.action}`);
      return { success: false, message: `Unknown action: ${action.action}` };
  }
}

// ===========================================
// Coordinate Validation & Sanitization
// ===========================================

/**
 * Sanitizes coordinates from the LLM response.
 * Handles: normal arrays, string values, single-element arrays with concatenated digits.
 * Returns a proper [x, y] tuple or undefined if unrecoverable.
 */
export function sanitizeCoordinates(
  raw: unknown
): [number, number] | undefined {
  if (raw == null) return undefined;

  // Normal case: [x, y] array with two numbers
  if (Array.isArray(raw) && raw.length >= 2) {
    const x = Number(raw[0]);
    const y = Number(raw[1]);
    if (Number.isFinite(x) && Number.isFinite(y) && x <= 10000 && y <= 10000) {
      return [Math.round(x), Math.round(y)];
    }
  }

  // Single-element array with concatenated number, e.g. [8282017] → [828, 2017]
  if (Array.isArray(raw) && raw.length === 1) {
    const split = trySplitConcatenated(Number(raw[0]));
    if (split) return split;
  }

  // Plain concatenated number (not in array)
  if (typeof raw === "number" && raw > 10000) {
    const split = trySplitConcatenated(raw);
    if (split) return split;
  }

  // String like "828, 2017" or "828 2017"
  if (typeof raw === "string") {
    const parts = (raw as string).split(/[,\s]+/).map(Number);
    if (parts.length >= 2 && parts.every(Number.isFinite)) {
      return [Math.round(parts[0]), Math.round(parts[1])];
    }
  }

  return undefined;
}

/**
 * Tries to split a concatenated number like 8282017 into [828, 2017].
 * Attempts splits at positions 2, 3, and 4 digits for the x value.
 */
function trySplitConcatenated(n: number): [number, number] | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = String(Math.round(n));
  // Try splitting at different positions (x is typically 2-4 digits)
  for (let i = 2; i <= Math.min(4, s.length - 2); i++) {
    const x = parseInt(s.slice(0, i), 10);
    const y = parseInt(s.slice(i), 10);
    if (x > 0 && x <= 3000 && y > 0 && y <= 5000) {
      return [x, y];
    }
  }
  return null;
}

/**
 * Validates coordinates are reasonable before executing ADB.
 * Returns [x, y] if valid, or null.
 */
function validateCoordinates(
  coords: [number, number] | undefined
): [number, number] | null {
  if (!coords || !Array.isArray(coords) || coords.length < 2) return null;
  const [x, y] = coords;
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < 0 || y < 0 || x > 10000 || y > 10000) return null;
  return [Math.round(x), Math.round(y)];
}

// ===========================================
// Original actions (enhanced)
// ===========================================

function executeTap(action: ActionDecision): ActionResult {
  const coords = validateCoordinates(action.coordinates);
  if (!coords) {
    console.log(`Invalid tap coordinates: ${JSON.stringify(action.coordinates)}`);
    return { success: false, message: `Invalid coordinates: ${JSON.stringify(action.coordinates)}` };
  }
  const [x, y] = coords;
  console.log(`Tapping: (${x}, ${y})`);
  runAdbCommand(["shell", "input", "tap", String(x), String(y)]);
  return { success: true, message: `Tapped (${x}, ${y})` };
}

function executeType(action: ActionDecision): ActionResult {
  const text = action.text ?? "";
  if (!text) return { success: false, message: "No text to type" };

  // If coordinates are provided, tap the field first to focus it
  if (action.coordinates) {
    const coords = validateCoordinates(action.coordinates);
    if (coords) {
      console.log(`Focusing field: (${coords[0]}, ${coords[1]})`);
      runAdbCommand(["shell", "input", "tap", String(coords[0]), String(coords[1])]);
      Bun.sleepSync(300); // Brief pause for focus to register
    }
  }

  // ADB requires %s for spaces, escape special shell characters.
  // Backslash must be escaped first to avoid double-escaping.
  const escapedText = text
    .replaceAll("\\", "\\\\")
    .replaceAll("\"", "\\\"")
    .replaceAll("'", "\\'")
    .replaceAll("`", "\\`")
    .replaceAll("$", "\\$")
    .replaceAll("!", "\\!")
    .replaceAll("?", "\\?")
    .replaceAll(" ", "%s")
    .replaceAll("&", "\\&")
    .replaceAll("|", "\\|")
    .replaceAll(";", "\\;")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
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
  const coords = validateCoordinates(action.coordinates);
  if (!coords) {
    console.log(`Invalid longpress coordinates: ${JSON.stringify(action.coordinates)}`);
    return { success: false, message: `Invalid coordinates: ${JSON.stringify(action.coordinates)}` };
  }
  const [x, y] = coords;
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
  // Safe shell escaping: wrap in single quotes, escape internal ' as '\''
  // This matches safeClipboardSet() in skills.ts
  const escaped = text.replaceAll("'", "'\\''");
  runAdbCommand(["shell", `cmd clipboard set-text '${escaped}'`]);
  return { success: true, message: `Clipboard set to "${text.slice(0, 50)}"` };
}

/**
 * Pastes clipboard content into the focused field.
 * Optionally taps coordinates first to focus the target field.
 */
function executePaste(action: ActionDecision): ActionResult {
  // If coordinates provided, tap to focus the target field first
  if (action.coordinates) {
    const coords = validateCoordinates(action.coordinates);
    if (coords) {
      console.log(`Focusing field: (${coords[0]}, ${coords[1]})`);
      runAdbCommand(["shell", "input", "tap", String(coords[0]), String(coords[1])]);
      Bun.sleepSync(300);
    }
  }
  console.log("Pasting from clipboard");
  runAdbCommand(["shell", "input", "keyevent", KEYCODE_PASTE]);
  return { success: true, message: "Pasted clipboard content" };
}

/**
 * Scrolls the screen. Direction is from the user's perspective:
 * "down" = see more content below (swipe up), "up" = see content above (swipe down).
 */
const SCROLL_TO_SWIPE: Record<string, string> = {
  down: "up",    // scroll down = swipe up
  up: "down",    // scroll up = swipe down
  left: "right", // scroll left = swipe right
  right: "left", // scroll right = swipe left
};

function executeScroll(action: ActionDecision): ActionResult {
  const direction = action.direction ?? "down";
  const swipeDir = SCROLL_TO_SWIPE[direction] ?? "up";
  const swipeCoords = getSwipeCoords();
  const coords = swipeCoords[swipeDir] ?? swipeCoords["up"];

  console.log(`Scrolling ${direction}`);
  runAdbCommand([
    "shell", "input", "swipe",
    String(coords[0]), String(coords[1]),
    String(coords[2]), String(coords[3]),
    SWIPE_DURATION_MS,
  ]);
  return { success: true, message: `Scrolled ${direction}` };
}

// ===========================================
// Phase 7: New actions
// ===========================================

/**
 * Opens a URL in the default browser.
 */
function executeOpenUrl(action: ActionDecision): ActionResult {
  const url = action.url ?? "";
  if (!url) return { success: false, message: "No URL provided" };
  console.log(`Opening URL: ${url}`);
  const result = runAdbCommand(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url]);
  return { success: true, message: `Opened URL: ${url}`, data: result };
}

/**
 * Switches to a specific app by package name.
 */
function executeSwitchApp(action: ActionDecision): ActionResult {
  const pkg = action.package ?? "";
  if (!pkg) return { success: false, message: "No package name provided" };
  console.log(`Switching to app: ${pkg}`);
  const result = runAdbCommand([
    "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1",
  ]);
  return { success: true, message: `Switched to ${pkg}`, data: result };
}

/**
 * Reads notification bar content. Parses title/text from active notifications.
 */
function executeNotifications(): ActionResult {
  console.log("Reading notifications");
  const raw = runAdbCommand(["shell", "dumpsys", "notification", "--noredact"]);
  // Parse title and text from NotificationRecord sections
  const notifications: string[] = [];
  let currentTitle = "";
  for (const line of raw.split("\n")) {
    const titleMatch = line.match(/android\.title=(?:String\s*\()?(.*?)(?:\)|$)/);
    const textMatch = line.match(/android\.text=(?:String\s*\()?(.*?)(?:\)|$)/);
    if (titleMatch) currentTitle = titleMatch[1].trim();
    if (textMatch && currentTitle) {
      notifications.push(`${currentTitle}: ${textMatch[1].trim()}`);
      currentTitle = "";
    }
  }
  const summary = notifications.length > 0
    ? notifications.join("\n")
    : "No notifications found";
  console.log(`Found ${notifications.length} notifications`);
  return { success: true, message: `Notifications:\n${summary}`, data: summary };
}

/**
 * Pulls a file from device to local machine.
 */
function executePullFile(action: ActionDecision): ActionResult {
  const devicePath = action.path ?? "";
  if (!devicePath) return { success: false, message: "No device path provided" };
  // Ensure pulled_files directory exists
  const { existsSync, mkdirSync } = require("node:fs");
  if (!existsSync("./pulled_files")) {
    mkdirSync("./pulled_files", { recursive: true });
  }
  const filename = devicePath.split("/").pop() ?? "file";
  const localPath = `./pulled_files/${filename}`;
  console.log(`Pulling file: ${devicePath} → ${localPath}`);
  const result = runAdbCommand(["pull", devicePath, localPath]);
  return { success: true, message: `Pulled ${devicePath} → ${localPath}`, data: result };
}

/**
 * Pushes a file from local machine to device.
 */
function executePushFile(action: ActionDecision): ActionResult {
  const source = action.source ?? "";
  const dest = action.dest ?? "";
  if (!source || !dest) return { success: false, message: "Missing source or dest path" };
  console.log(`Pushing file: ${source} → ${dest}`);
  const result = runAdbCommand(["push", source, dest]);
  return { success: true, message: `Pushed ${source} → ${dest}`, data: result };
}

/**
 * Sends any Android keycode. Escape hatch for keys not covered by other actions.
 */
function executeKeyevent(action: ActionDecision): ActionResult {
  const code = action.code;
  if (code == null) return { success: false, message: "No keycode provided" };
  console.log(`Sending keyevent: ${code}`);
  runAdbCommand(["shell", "input", "keyevent", String(code)]);
  return { success: true, message: `Sent keyevent ${code}` };
}

/**
 * Opens specific Android settings screens.
 */
const SETTINGS_MAP: Record<string, string> = {
  wifi: "android.settings.WIFI_SETTINGS",
  bluetooth: "android.settings.BLUETOOTH_SETTINGS",
  display: "android.settings.DISPLAY_SETTINGS",
  sound: "android.settings.SOUND_SETTINGS",
  battery: "android.settings.BATTERY_SAVER_SETTINGS",
  location: "android.settings.LOCATION_SOURCE_SETTINGS",
  apps: "android.settings.APPLICATION_SETTINGS",
  date: "android.settings.DATE_SETTINGS",
  accessibility: "android.settings.ACCESSIBILITY_SETTINGS",
  developer: "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
};

function executeOpenSettings(action: ActionDecision): ActionResult {
  const setting = action.setting ?? "";
  const intentAction = SETTINGS_MAP[setting];
  if (!intentAction) {
    const valid = Object.keys(SETTINGS_MAP).join(", ");
    return { success: false, message: `Unknown setting "${setting}". Valid: ${valid}` };
  }
  console.log(`Opening settings: ${setting}`);
  const result = runAdbCommand(["shell", "am", "start", "-a", intentAction]);
  return { success: true, message: `Opened ${setting} settings`, data: result };
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

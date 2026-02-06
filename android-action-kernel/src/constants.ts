/**
 * Constants for Android Action Kernel.
 * All magic strings, URLs, and fixed values in one place.
 */

// ===========================================
// API Endpoints
// ===========================================
export const GROQ_API_BASE_URL = "https://api.groq.com/openai/v1";

// ===========================================
// ADB Key Codes
// ===========================================
export const KEYCODE_ENTER = "66";
export const KEYCODE_HOME = "KEYCODE_HOME";
export const KEYCODE_BACK = "KEYCODE_BACK";
export const KEYCODE_DEL = "67";
export const KEYCODE_FORWARD_DEL = "112";
export const KEYCODE_MOVE_HOME = "122";
export const KEYCODE_MOVE_END = "123";
export const KEYCODE_MENU = "82";
export const KEYCODE_TAB = "61";
export const KEYCODE_ESCAPE = "111";
export const KEYCODE_DPAD_UP = "19";
export const KEYCODE_DPAD_DOWN = "20";
export const KEYCODE_DPAD_LEFT = "21";
export const KEYCODE_DPAD_RIGHT = "22";
export const KEYCODE_VOLUME_UP = "24";
export const KEYCODE_VOLUME_DOWN = "25";
export const KEYCODE_POWER = "26";

// ===========================================
// Default Screen Coordinates (for swipe actions)
// Adjust based on target device resolution
// ===========================================
export const SCREEN_CENTER_X = 540;
export const SCREEN_CENTER_Y = 1200;

// Swipe coordinates: [start_x, start_y, end_x, end_y]
export const SWIPE_COORDS: Record<string, [number, number, number, number]> = {
  up: [SCREEN_CENTER_X, 1500, SCREEN_CENTER_X, 500],
  down: [SCREEN_CENTER_X, 500, SCREEN_CENTER_X, 1500],
  left: [800, SCREEN_CENTER_Y, 200, SCREEN_CENTER_Y],
  right: [200, SCREEN_CENTER_Y, 800, SCREEN_CENTER_Y],
};
export const SWIPE_DURATION_MS = "300";
export const LONG_PRESS_DURATION_MS = "1000";

// ===========================================
// Default Models
// ===========================================
export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";
export const DEFAULT_OPENAI_MODEL = "gpt-4o";
export const DEFAULT_BEDROCK_MODEL = "us.meta.llama3-3-70b-instruct-v1:0";
export const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";

// ===========================================
// Bedrock Model Identifiers
// ===========================================
export const BEDROCK_ANTHROPIC_MODELS = ["anthropic"];
export const BEDROCK_META_MODELS = ["meta", "llama"];

// ===========================================
// File Paths
// ===========================================
export const DEVICE_DUMP_PATH = "/sdcard/window_dump.xml";
export const LOCAL_DUMP_PATH = "window_dump.xml";
export const DEVICE_SCREENSHOT_PATH = "/sdcard/kernel_screenshot.png";
export const LOCAL_SCREENSHOT_PATH = "kernel_screenshot.png";

// ===========================================
// Agent Defaults
// ===========================================
export const DEFAULT_MAX_STEPS = 30;
export const DEFAULT_STEP_DELAY = 2.0;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_STUCK_THRESHOLD = 3;
export const DEFAULT_VISION_ENABLED = true;

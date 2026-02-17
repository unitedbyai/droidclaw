import type { UIElement, DeviceInfo } from "./types.js";

export type DeviceMessage =
  | { type: "auth"; apiKey: string; deviceInfo?: DeviceInfo }
  | { type: "screen"; requestId: string; elements: UIElement[]; screenshot?: string; packageName?: string }
  | { type: "result"; requestId: string; success: boolean; error?: string; data?: string }
  | { type: "goal"; text: string }
  | { type: "pong" };

export type ServerToDeviceMessage =
  | { type: "auth_ok"; deviceId: string }
  | { type: "auth_error"; message: string }
  | { type: "get_screen"; requestId: string }
  | { type: "tap"; requestId: string; x: number; y: number }
  | { type: "type"; requestId: string; text: string }
  | { type: "swipe"; requestId: string; x1: number; y1: number; x2: number; y2: number; duration?: number }
  | { type: "enter"; requestId: string }
  | { type: "back"; requestId: string }
  | { type: "home"; requestId: string }
  | { type: "longpress"; requestId: string; x: number; y: number }
  | { type: "launch"; requestId: string; packageName: string }
  | { type: "clear"; requestId: string }
  | { type: "clipboard_set"; requestId: string; text: string }
  | { type: "clipboard_get"; requestId: string }
  | { type: "paste"; requestId: string }
  | { type: "open_url"; requestId: string; url: string }
  | { type: "switch_app"; requestId: string; packageName: string }
  | { type: "notifications"; requestId: string }
  | { type: "keyevent"; requestId: string; code: number }
  | { type: "open_settings"; requestId: string }
  | { type: "wait"; requestId: string; duration?: number }
  | { type: "ping" }
  | { type: "goal_started"; sessionId: string; goal: string }
  | { type: "goal_completed"; sessionId: string; success: boolean; stepsUsed: number };

export type DashboardMessage =
  | { type: "device_online"; deviceId: string; name: string }
  | { type: "device_offline"; deviceId: string }
  | { type: "step"; sessionId: string; step: number; action: Record<string, unknown>; reasoning: string; screenHash: string }
  | { type: "goal_started"; sessionId: string; goal: string; deviceId: string }
  | { type: "goal_completed"; sessionId: string; success: boolean; stepsUsed: number };

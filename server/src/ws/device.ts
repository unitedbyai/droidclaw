import type { ServerWebSocket } from "bun";
import type { DeviceMessage } from "@droidclaw/shared";
import { eq, and } from "drizzle-orm";
import { auth } from "../auth.js";
import { db } from "../db.js";
import { llmConfig, device, agentSession, agentStep } from "../schema.js";
import { sessions, type WebSocketData } from "./sessions.js";
import { runAgentLoop } from "../agent/loop.js";
import { preprocessGoal } from "../agent/preprocessor.js";
import type { LLMConfig } from "../agent/llm.js";

/** Track running agent sessions to prevent duplicates per device */
const activeSessions = new Map<string, string>();

/**
 * Send a JSON message to a device WebSocket (safe — catches send errors).
 */
function sendToDevice(ws: ServerWebSocket<WebSocketData>, msg: Record<string, unknown>) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // device disconnected
  }
}

/**
 * Upsert a device record in the DB. Returns the persistent device ID.
 * Matches on userId + model name so reconnects reuse the same record.
 */
async function upsertDevice(
  userId: string,
  name: string,
  deviceInfo?: Record<string, unknown>
): Promise<string> {
  // Try to find existing device by userId + name
  const existing = await db
    .select()
    .from(device)
    .where(and(eq(device.userId, userId), eq(device.name, name)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(device)
      .set({ status: "online", lastSeen: new Date(), deviceInfo: deviceInfo ?? null })
      .where(eq(device.id, existing[0].id));
    return existing[0].id;
  }

  const id = crypto.randomUUID();
  await db.insert(device).values({
    id,
    userId,
    name,
    status: "online",
    lastSeen: new Date(),
    deviceInfo: deviceInfo ?? null,
  });
  return id;
}

/**
 * Handle an incoming message from an Android device WebSocket.
 */
export async function handleDeviceMessage(
  ws: ServerWebSocket<WebSocketData>,
  raw: string
): Promise<void> {
  let msg: DeviceMessage;
  try {
    msg = JSON.parse(raw) as DeviceMessage;
  } catch {
    ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
    return;
  }

  // ── Authentication ─────────────────────────────────────

  if (msg.type === "auth") {
    try {
      const result = await auth.api.verifyApiKey({
        body: { key: msg.apiKey },
      });

      if (!result.valid || !result.key) {
        ws.send(
          JSON.stringify({
            type: "auth_error",
            message: result.error?.message ?? "Invalid API key",
          })
        );
        return;
      }

      const deviceId = crypto.randomUUID();
      const userId = result.key.userId;

      // Build device name from device info
      const name = msg.deviceInfo
        ? `${msg.deviceInfo.model} (Android ${msg.deviceInfo.androidVersion})`
        : "Unknown Device";

      // Persist device to DB (upsert by userId + name)
      let persistentDeviceId: string;
      try {
        persistentDeviceId = await upsertDevice(
          userId,
          name,
          msg.deviceInfo as unknown as Record<string, unknown>
        );
      } catch (err) {
        console.error(`[Device] Failed to upsert device record: ${err}`);
        persistentDeviceId = deviceId; // fallback to ephemeral ID
      }

      // Mark connection as authenticated
      ws.data.authenticated = true;
      ws.data.userId = userId;
      ws.data.deviceId = deviceId;
      ws.data.persistentDeviceId = persistentDeviceId;

      // Register device in session manager
      sessions.addDevice({
        deviceId,
        persistentDeviceId,
        userId,
        ws,
        deviceInfo: msg.deviceInfo,
        connectedAt: new Date(),
      });

      // Confirm auth to the device
      ws.send(JSON.stringify({ type: "auth_ok", deviceId }));

      // Notify dashboard subscribers
      sessions.notifyDashboard(userId, {
        type: "device_online",
        deviceId: persistentDeviceId,
        name,
      });

      console.log(`Device authenticated: ${deviceId} (db: ${persistentDeviceId}) for user ${userId}`);
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: "auth_error",
          message: "Authentication failed",
        })
      );
      console.error("Device auth error:", err);
    }
    return;
  }

  // ── All other messages require authentication ─────────

  if (!ws.data.authenticated) {
    ws.send(
      JSON.stringify({ type: "error", message: "Not authenticated" })
    );
    return;
  }

  switch (msg.type) {
    case "screen": {
      sessions.resolveRequest(msg.requestId, {
        type: "screen",
        elements: msg.elements,
        screenshot: msg.screenshot,
        packageName: msg.packageName,
      });
      break;
    }

    case "result": {
      sessions.resolveRequest(msg.requestId, {
        type: "result",
        success: msg.success,
        error: msg.error,
        data: msg.data,
      });
      break;
    }

    case "goal": {
      const deviceId = ws.data.deviceId!;
      const userId = ws.data.userId!;
      const persistentDeviceId = ws.data.persistentDeviceId!;
      const goal = msg.text;

      if (!goal) {
        sendToDevice(ws, { type: "goal_failed", message: "Empty goal" });
        break;
      }

      if (activeSessions.has(deviceId)) {
        sendToDevice(ws, { type: "goal_failed", message: "Agent already running on this device" });
        break;
      }

      // Fetch user's LLM config
      let userLlmConfig: LLMConfig;
      try {
        const configs = await db
          .select()
          .from(llmConfig)
          .where(eq(llmConfig.userId, userId))
          .limit(1);

        if (configs.length === 0) {
          sendToDevice(ws, { type: "goal_failed", message: "No LLM provider configured. Set it up in the web dashboard Settings." });
          break;
        }

        const cfg = configs[0];
        userLlmConfig = {
          provider: cfg.provider,
          apiKey: cfg.apiKey,
          model: cfg.model ?? undefined,
        };
      } catch (err) {
        console.error(`[Agent] Failed to fetch LLM config for user ${userId}:`, err);
        sendToDevice(ws, { type: "goal_failed", message: "Failed to load LLM configuration" });
        break;
      }

      // Preprocess: handle simple goals directly, or extract "open X" prefix
      let effectiveGoal = goal;
      try {
        const preResult = await preprocessGoal(deviceId, goal);
        if (preResult.handled) {
          await new Promise((r) => setTimeout(r, 1500));

          if (preResult.refinedGoal) {
            effectiveGoal = preResult.refinedGoal;
            sendToDevice(ws, {
              type: "step",
              step: 0,
              action: preResult.command,
              reasoning: "Preprocessor: launched app directly",
            });
          } else {
            // Pure "open X" — fully handled. Persist to DB then return.
            const sessionId = crypto.randomUUID();
            try {
              await db.insert(agentSession).values({
                id: sessionId,
                userId,
                deviceId: persistentDeviceId,
                goal,
                status: "completed",
                stepsUsed: 1,
                completedAt: new Date(),
              });
              await db.insert(agentStep).values({
                id: crypto.randomUUID(),
                sessionId,
                stepNumber: 1,
                action: preResult.command ?? null,
                reasoning: `Preprocessor: direct ${preResult.command?.type} action`,
                result: "OK",
              });
            } catch (err) {
              console.error(`[DB] Failed to save preprocessor session: ${err}`);
            }

            sendToDevice(ws, { type: "goal_started", sessionId, goal });
            sendToDevice(ws, {
              type: "step",
              step: 1,
              action: preResult.command,
              reasoning: `Preprocessor: direct ${preResult.command?.type} action`,
            });
            sendToDevice(ws, { type: "goal_completed", success: true, stepsUsed: 1 });

            sessions.notifyDashboard(userId, { type: "goal_completed", sessionId, success: true, stepsUsed: 1 });

            console.log(`[Preprocessor] Goal handled directly: ${goal}`);
            break;
          }
        }
      } catch (err) {
        console.warn(`[Preprocessor] Error (falling through to LLM): ${err}`);
      }

      console.log(`[Agent] Starting goal for device ${deviceId}: ${effectiveGoal}${effectiveGoal !== goal ? ` (original: ${goal})` : ""}`);
      activeSessions.set(deviceId, goal);

      sendToDevice(ws, { type: "goal_started", sessionId: deviceId, goal });

      // Run agent loop in background (DB persistence happens inside the loop)
      runAgentLoop({
        deviceId,
        persistentDeviceId,
        userId,
        goal: effectiveGoal,
        originalGoal: goal !== effectiveGoal ? goal : undefined,
        llmConfig: userLlmConfig,
        onStep(step) {
          sendToDevice(ws, {
            type: "step",
            step: step.stepNumber,
            action: step.action,
            reasoning: step.reasoning,
          });
        },
        onComplete(result) {
          activeSessions.delete(deviceId);
          sendToDevice(ws, {
            type: "goal_completed",
            success: result.success,
            stepsUsed: result.stepsUsed,
          });
          console.log(
            `[Agent] Completed on ${deviceId}: ${result.success ? "success" : "incomplete"} in ${result.stepsUsed} steps`
          );
        },
      }).catch((err) => {
        activeSessions.delete(deviceId);
        sendToDevice(ws, { type: "goal_failed", message: String(err) });
        console.error(`[Agent] Error on ${deviceId}:`, err);
      });

      break;
    }

    case "pong": {
      break;
    }

    case "heartbeat": {
      const persistentDeviceId = ws.data.persistentDeviceId;
      const userId = ws.data.userId;
      if (persistentDeviceId && userId) {
        // Update deviceInfo in DB with latest battery
        db.update(device)
          .set({
            deviceInfo: {
              ...(await db.select({ info: device.deviceInfo }).from(device).where(eq(device.id, persistentDeviceId)).limit(1).then(r => (r[0]?.info as Record<string, unknown>) ?? {})),
              batteryLevel: msg.batteryLevel,
              isCharging: msg.isCharging,
            },
            lastSeen: new Date(),
          })
          .where(eq(device.id, persistentDeviceId))
          .catch((err) => console.error(`[DB] Failed to update heartbeat: ${err}`));

        // Broadcast to dashboard
        sessions.notifyDashboard(userId, {
          type: "device_status",
          deviceId: persistentDeviceId,
          batteryLevel: msg.batteryLevel,
          isCharging: msg.isCharging,
        });
      }
      break;
    }

    default: {
      console.warn(
        `Unknown message type from device ${ws.data.deviceId}:`,
        (msg as Record<string, unknown>).type
      );
    }
  }
}

/**
 * Handle a device WebSocket disconnection.
 */
export function handleDeviceClose(
  ws: ServerWebSocket<WebSocketData>
): void {
  const { deviceId, userId, persistentDeviceId } = ws.data;
  if (!deviceId) return;

  activeSessions.delete(deviceId);
  sessions.removeDevice(deviceId);

  // Update device status in DB
  if (persistentDeviceId) {
    db.update(device)
      .set({ status: "offline", lastSeen: new Date() })
      .where(eq(device.id, persistentDeviceId))
      .catch((err) => console.error(`[DB] Failed to update device status: ${err}`));
  }

  if (userId) {
    sessions.notifyDashboard(userId, {
      type: "device_offline",
      deviceId: persistentDeviceId ?? deviceId,
    });
  }

  console.log(`Device disconnected: ${deviceId}`);
}

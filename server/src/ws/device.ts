import type { ServerWebSocket } from "bun";
import type { DeviceMessage } from "@droidclaw/shared";
import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { apikey, llmConfig, device } from "../schema.js";
import { sessions, type WebSocketData } from "./sessions.js";
import { runPipeline } from "../agent/pipeline.js";
import type { LLMConfig } from "../agent/llm.js";
import {
  handleWorkflowCreate,
  handleWorkflowUpdate,
  handleWorkflowDelete,
  handleWorkflowSync,
  handleWorkflowTrigger,
} from "./workflow-handlers.js";
import { classifyInput } from "../agent/input-classifier.js";

/**
 * Hash an API key the same way better-auth does:
 * SHA-256 → base64url (no padding).
 */
async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  // base64url encode without padding
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Track running agent sessions to prevent duplicates per device */
const activeSessions = new Map<string, { goal: string; abort: AbortController }>();

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
      // Hash the incoming key and look it up directly in the DB
      const hashedKey = await hashApiKey(msg.apiKey);
      const rows = await db
        .select({ id: apikey.id, userId: apikey.userId, enabled: apikey.enabled, expiresAt: apikey.expiresAt })
        .from(apikey)
        .where(eq(apikey.key, hashedKey))
        .limit(1);

      if (rows.length === 0 || !rows[0].enabled) {
        ws.send(
          JSON.stringify({
            type: "auth_error",
            message: "Invalid API key",
          })
        );
        return;
      }

      // Check expiration
      if (rows[0].expiresAt && rows[0].expiresAt < new Date()) {
        ws.send(
          JSON.stringify({
            type: "auth_error",
            message: "API key expired",
          })
        );
        return;
      }

      const deviceId = crypto.randomUUID();
      const userId = rows[0].userId;

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

      // Classify: is this an immediate goal or a workflow?
      try {
        const classification = await classifyInput(goal, userLlmConfig);
        if (classification.type === "workflow") {
          console.log(`[Classifier] Input classified as workflow: ${goal}`);
          handleWorkflowCreate(ws, goal).catch((err) =>
            console.error(`[Workflow] Auto-create error:`, err)
          );
          break;
        }
      } catch (err) {
        console.warn(`[Classifier] Classification failed, treating as goal:`, err);
      }

      console.log(`[Pipeline] Starting goal for device ${deviceId}: ${goal}`);
      const abortController = new AbortController();
      activeSessions.set(deviceId, { goal, abort: abortController });

      sendToDevice(ws, { type: "goal_started", sessionId: deviceId, goal });

      runPipeline({
        deviceId,
        persistentDeviceId,
        userId,
        goal,
        llmConfig: userLlmConfig,
        signal: abortController.signal,
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
            `[Pipeline] Completed on ${deviceId}: ${result.success ? "success" : "incomplete"} in ${result.stepsUsed} steps`
          );
        },
      }).catch((err) => {
        activeSessions.delete(deviceId);
        sendToDevice(ws, { type: "goal_failed", message: String(err) });
        console.error(`[Pipeline] Error on ${deviceId}:`, err);
      });

      break;
    }

    case "pong": {
      break;
    }

    case "stop_goal": {
      const deviceId = ws.data.deviceId!;
      const active = activeSessions.get(deviceId);
      if (active) {
        console.log(`[Pipeline] Stop requested for device ${deviceId}`);
        active.abort.abort();
        activeSessions.delete(deviceId);
        sendToDevice(ws, {
          type: "goal_completed",
          sessionId: deviceId,
          success: false,
          stepsUsed: 0,
        });
      }
      break;
    }

    case "apps": {
      const persistentDeviceId = ws.data.persistentDeviceId;
      if (persistentDeviceId) {
        const apps = (msg as unknown as { apps: Array<{ packageName: string; label: string; intents?: string[] }> }).apps;
        // Merge apps into existing deviceInfo
        db.update(device)
          .set({
            deviceInfo: {
              ...(await db.select({ info: device.deviceInfo }).from(device).where(eq(device.id, persistentDeviceId)).limit(1).then(r => (r[0]?.info as Record<string, unknown>) ?? {})),
              installedApps: apps,
            },
          })
          .where(eq(device.id, persistentDeviceId))
          .catch((err) => console.error(`[DB] Failed to store installed apps: ${err}`));

        console.log(`[Device] Received ${apps.length} installed apps for device ${persistentDeviceId}`);
      }
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

    case "workflow_create": {
      const description = (msg as unknown as { description: string }).description;
      if (description) {
        handleWorkflowCreate(ws, description).catch((err) =>
          console.error(`[Workflow] Create error:`, err)
        );
      }
      break;
    }

    case "workflow_update": {
      const { workflowId, enabled } = msg as unknown as { workflowId: string; enabled?: boolean };
      if (workflowId) {
        handleWorkflowUpdate(ws, workflowId, enabled).catch((err) =>
          console.error(`[Workflow] Update error:`, err)
        );
      }
      break;
    }

    case "workflow_delete": {
      const { workflowId } = msg as unknown as { workflowId: string };
      if (workflowId) {
        handleWorkflowDelete(ws, workflowId).catch((err) =>
          console.error(`[Workflow] Delete error:`, err)
        );
      }
      break;
    }

    case "workflow_sync": {
      handleWorkflowSync(ws).catch((err) =>
        console.error(`[Workflow] Sync error:`, err)
      );
      break;
    }

    case "workflow_trigger": {
      const { workflowId, notificationApp, notificationTitle, notificationText } =
        msg as unknown as {
          workflowId: string;
          notificationApp?: string;
          notificationTitle?: string;
          notificationText?: string;
        };
      if (workflowId) {
        handleWorkflowTrigger(ws, workflowId, notificationApp, notificationTitle, notificationText).catch(
          (err) => console.error(`[Workflow] Trigger error:`, err)
        );
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

  const active = activeSessions.get(deviceId);
  if (active) {
    active.abort.abort();
    activeSessions.delete(deviceId);
  }
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

import { Hono } from "hono";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { runAgentLoop, type AgentLoopOptions } from "../agent/loop.js";
import type { LLMConfig } from "../agent/llm.js";

const goals = new Hono<AuthEnv>();
goals.use("*", sessionMiddleware);

/** Track running agent sessions so we can prevent duplicates */
const activeSessions = new Map<string, { sessionId: string; goal: string }>();

goals.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    goal: string;
    llmProvider?: string;
    llmApiKey?: string;
    llmModel?: string;
    maxSteps?: number;
  }>();

  if (!body.deviceId || !body.goal) {
    return c.json({ error: "deviceId and goal are required" }, 400);
  }

  // Look up by connection ID first, then by persistent DB ID
  const device = sessions.getDevice(body.deviceId)
    ?? sessions.getDeviceByPersistentId(body.deviceId);
  if (!device) {
    return c.json({ error: "device not connected" }, 404);
  }

  if (device.userId !== user.id) {
    return c.json({ error: "device does not belong to you" }, 403);
  }

  // Prevent multiple agent loops on the same device
  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  if (activeSessions.has(trackingKey)) {
    const existing = activeSessions.get(trackingKey)!;
    return c.json(
      { error: "agent already running on this device", sessionId: existing.sessionId, goal: existing.goal },
      409
    );
  }

  // Build LLM config from request body or environment defaults
  const llmConfig: LLMConfig = {
    provider: body.llmProvider ?? process.env.LLM_PROVIDER ?? "openai",
    apiKey: body.llmApiKey ?? process.env.LLM_API_KEY ?? "",
    model: body.llmModel,
  };

  if (!llmConfig.apiKey) {
    return c.json({ error: "LLM API key is required (provide llmApiKey or set LLM_API_KEY env var)" }, 400);
  }

  const options: AgentLoopOptions = {
    deviceId: device.deviceId,
    persistentDeviceId: device.persistentDeviceId,
    userId: user.id,
    goal: body.goal,
    llmConfig,
    maxSteps: body.maxSteps,
  };

  // Start the agent loop in the background (fire-and-forget).
  // The client observes progress via the /ws/dashboard WebSocket.
  const loopPromise = runAgentLoop(options);

  // Track as active until it completes
  const sessionPlaceholder = { sessionId: "pending", goal: body.goal };
  activeSessions.set(trackingKey, sessionPlaceholder);

  loopPromise
    .then((result) => {
      activeSessions.delete(trackingKey);
      console.log(
        `[Agent] Completed on ${device.deviceId}: ${result.success ? "success" : "incomplete"} in ${result.stepsUsed} steps (session ${result.sessionId})`
      );
    })
    .catch((err) => {
      activeSessions.delete(trackingKey);
      console.error(`[Agent] Error on ${device.deviceId}: ${err}`);
    });

  // We need the sessionId from the loop, but it's created inside runAgentLoop.
  // For immediate response, generate one here and let the dashboard events carry the real one.
  // The loop will emit goal_started with its sessionId momentarily.
  return c.json({
    deviceId: body.deviceId,
    goal: body.goal,
    status: "started",
  });
});

export { goals };

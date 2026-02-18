/**
 * Server-side handlers for workflow CRUD and trigger messages
 * from the Android device WebSocket.
 */

import type { ServerWebSocket } from "bun";
import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { workflow, llmConfig } from "../schema.js";
import { parseWorkflowDescription } from "../agent/workflow-parser.js";
import type { LLMConfig } from "../agent/llm.js";
import type { WebSocketData } from "./sessions.js";

function sendToDevice(ws: ServerWebSocket<WebSocketData>, msg: Record<string, unknown>) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // device disconnected
  }
}

async function getUserLlmConfig(userId: string): Promise<LLMConfig | null> {
  const configs = await db
    .select()
    .from(llmConfig)
    .where(eq(llmConfig.userId, userId))
    .limit(1);

  if (configs.length === 0) return null;

  const cfg = configs[0];
  return {
    provider: cfg.provider,
    apiKey: cfg.apiKey,
    model: cfg.model ?? undefined,
  };
}

function workflowToJson(wf: typeof workflow.$inferSelect): string {
  return JSON.stringify({
    id: wf.id,
    name: wf.name,
    description: wf.description,
    triggerType: wf.triggerType,
    conditions: wf.conditions,
    goalTemplate: wf.goalTemplate,
    enabled: wf.enabled,
    createdAt: new Date(wf.createdAt).getTime(),
  });
}

export async function handleWorkflowCreate(
  ws: ServerWebSocket<WebSocketData>,
  description: string
): Promise<void> {
  const userId = ws.data.userId!;

  const userLlm = await getUserLlmConfig(userId);
  if (!userLlm) {
    sendToDevice(ws, {
      type: "error",
      message: "No LLM provider configured. Set it up in the web dashboard.",
    });
    return;
  }

  try {
    const parsed = await parseWorkflowDescription(description, userLlm);

    // Validate regexes before persisting
    for (const cond of parsed.conditions) {
      if (cond.matchMode === "regex") {
        try {
          new RegExp(cond.value, "i");
        } catch {
          throw new Error(`Invalid regex in condition: ${cond.value}`);
        }
      }
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db.insert(workflow).values({
      id,
      userId,
      name: parsed.name,
      description,
      triggerType: parsed.triggerType,
      conditions: parsed.conditions,
      goalTemplate: parsed.goalTemplate,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });

    const inserted = await db
      .select()
      .from(workflow)
      .where(eq(workflow.id, id))
      .limit(1);

    if (inserted.length > 0) {
      sendToDevice(ws, {
        type: "workflow_created",
        workflowId: id,
        workflowJson: workflowToJson(inserted[0]),
      });
    }

    console.log(`[Workflow] Created '${parsed.name}' for user ${userId}`);
  } catch (err) {
    console.error(`[Workflow] Failed to create workflow:`, err);
    sendToDevice(ws, {
      type: "error",
      message: `Failed to parse workflow: ${err}`,
    });
  }
}

export async function handleWorkflowUpdate(
  ws: ServerWebSocket<WebSocketData>,
  workflowId: string,
  enabled?: boolean
): Promise<void> {
  const userId = ws.data.userId!;

  const updates: Record<string, unknown> = {};
  if (enabled !== undefined) updates.enabled = enabled;

  await db
    .update(workflow)
    .set(updates)
    .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)));

  console.log(`[Workflow] Updated ${workflowId}: enabled=${enabled}`);
}

export async function handleWorkflowDelete(
  ws: ServerWebSocket<WebSocketData>,
  workflowId: string
): Promise<void> {
  const userId = ws.data.userId!;

  await db
    .delete(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)));

  sendToDevice(ws, {
    type: "workflow_deleted",
    workflowId,
  });

  console.log(`[Workflow] Deleted ${workflowId}`);
}

export async function handleWorkflowSync(
  ws: ServerWebSocket<WebSocketData>
): Promise<void> {
  const userId = ws.data.userId!;

  const workflows = await db
    .select()
    .from(workflow)
    .where(eq(workflow.userId, userId));

  const workflowsJson = JSON.stringify(
    workflows.map((wf) => ({
      id: wf.id,
      name: wf.name,
      description: wf.description,
      triggerType: wf.triggerType,
      conditions: wf.conditions,
      goalTemplate: wf.goalTemplate,
      enabled: wf.enabled,
      createdAt: new Date(wf.createdAt).getTime(),
    }))
  );

  sendToDevice(ws, {
    type: "workflow_synced",
    workflowsJson,
  });

  console.log(`[Workflow] Synced ${workflows.length} workflows for user ${userId}`);
}

export async function handleWorkflowTrigger(
  ws: ServerWebSocket<WebSocketData>,
  workflowId: string,
  notificationApp?: string,
  notificationTitle?: string,
  notificationText?: string
): Promise<void> {
  const userId = ws.data.userId!;

  const workflows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), eq(workflow.userId, userId)))
    .limit(1);

  if (workflows.length === 0) {
    console.warn(`[Workflow] Trigger for unknown workflow ${workflowId}`);
    return;
  }

  const wf = workflows[0];
  if (!wf.enabled) return;

  // Expand goal template placeholders
  let goal = wf.goalTemplate;
  goal = goal.replace(/\{\{app\}\}/g, notificationApp ?? "unknown app");
  goal = goal.replace(/\{\{title\}\}/g, notificationTitle ?? "");
  goal = goal.replace(/\{\{text\}\}/g, notificationText ?? "");

  console.log(`[Workflow] Triggering '${wf.name}' with goal: ${goal}`);

  // Send as a goal — reuse existing goal handling by injecting a goal message
  sendToDevice(ws, { type: "ping" }); // keep-alive before goal injection

  // The device will receive this as a workflow-triggered goal
  // We send the goal text back to the device to be submitted as a regular goal
  sendToDevice(ws, {
    type: "workflow_goal",
    workflowId: wf.id,
    goal,
  });
}

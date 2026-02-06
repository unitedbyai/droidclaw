/**
 * Session logging for Android Action Kernel.
 * Writes incremental .partial.json after each step (crash-safe),
 * and a final .json summary at session end.
 */

import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { ActionDecision } from "./actions.js";

export interface StepLog {
  step: number;
  timestamp: string;
  foregroundApp: string | null;
  elementCount: number;
  screenChanged: boolean;
  llmDecision: {
    action: string;
    reason?: string;
    coordinates?: [number, number];
    text?: string;
    think?: string;
    plan?: string[];
    planProgress?: string;
  };
  actionResult: {
    success: boolean;
    message: string;
  };
  llmLatencyMs: number;
  actionLatencyMs: number;
}

export interface SessionSummary {
  sessionId: string;
  goal: string;
  provider: string;
  model: string;
  startTime: string;
  endTime: string;
  totalSteps: number;
  successCount: number;
  failCount: number;
  completed: boolean;
  steps: StepLog[];
}

export class SessionLogger {
  private sessionId: string;
  private logDir: string;
  private steps: StepLog[] = [];
  private goal: string;
  private provider: string;
  private model: string;
  private startTime: string;

  constructor(logDir: string, goal: string, provider: string, model: string) {
    this.sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logDir = logDir;
    this.goal = goal;
    this.provider = provider;
    this.model = model;
    this.startTime = new Date().toISOString();

    mkdirSync(this.logDir, { recursive: true });
  }

  logStep(
    step: number,
    foregroundApp: string | null,
    elementCount: number,
    screenChanged: boolean,
    decision: ActionDecision,
    result: { success: boolean; message: string },
    llmLatencyMs: number,
    actionLatencyMs: number
  ): void {
    const entry: StepLog = {
      step,
      timestamp: new Date().toISOString(),
      foregroundApp,
      elementCount,
      screenChanged,
      llmDecision: {
        action: decision.action,
        reason: decision.reason,
        coordinates: decision.coordinates,
        text: decision.text,
        think: decision.think,
        plan: decision.plan,
        planProgress: decision.planProgress,
      },
      actionResult: {
        success: result.success,
        message: result.message,
      },
      llmLatencyMs,
      actionLatencyMs,
    };
    this.steps.push(entry);

    // Write partial file after each step (crash-safe)
    const partialPath = join(this.logDir, `${this.sessionId}.partial.json`);
    writeFileSync(partialPath, JSON.stringify(this.buildSummary(false), null, 2));
  }

  finalize(completed: boolean): void {
    const summary = this.buildSummary(completed);
    const finalPath = join(this.logDir, `${this.sessionId}.json`);
    writeFileSync(finalPath, JSON.stringify(summary, null, 2));
    console.log(`Session log saved: ${finalPath}`);
  }

  private buildSummary(completed: boolean): SessionSummary {
    return {
      sessionId: this.sessionId,
      goal: this.goal,
      provider: this.provider,
      model: this.model,
      startTime: this.startTime,
      endTime: new Date().toISOString(),
      totalSteps: this.steps.length,
      successCount: this.steps.filter((s) => s.actionResult.success).length,
      failCount: this.steps.filter((s) => !s.actionResult.success).length,
      completed,
      steps: this.steps,
    };
  }
}

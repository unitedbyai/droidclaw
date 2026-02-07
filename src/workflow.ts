/**
 * Workflow orchestration engine for DroidClaw.
 *
 * Executes a sequence of sub-goals, each optionally scoped to a specific app.
 * This is DroidClaw's equivalent of `analyze_and_act(sub_goal, app)`.
 *
 * Usage:
 *   bun run src/kernel.ts --workflow examples/logistics-workflow.json
 */

import { runAgent } from "./kernel.js";
import { runAdbCommand } from "./actions.js";

// ===========================================
// Types
// ===========================================

export interface WorkflowStep {
  goal: string;
  app?: string;
  maxSteps?: number;
  formData?: Record<string, string>;
}

export interface Workflow {
  name: string;
  steps: WorkflowStep[];
}

export interface StepResult {
  goal: string;
  app?: string;
  success: boolean;
  stepsUsed: number;
  error?: string;
}

export interface WorkflowResult {
  name: string;
  steps: StepResult[];
  success: boolean;
}

// ===========================================
// Workflow Engine
// ===========================================

const DEFAULT_STEP_LIMIT = 15;
const APP_LAUNCH_DELAY_MS = 2000;

/**
 * Builds the effective goal string for a workflow step.
 * Appends structured form data if present.
 */
function buildGoal(step: WorkflowStep): string {
  let goal = step.goal;

  if (step.formData && Object.keys(step.formData).length > 0) {
    const lines = Object.entries(step.formData)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
    goal += `\n\nFORM DATA TO FILL:\n${lines}\n\nFind each field on screen and enter the corresponding value.`;
  }

  return goal;
}

/**
 * Switches to the specified app by launching it via monkey.
 */
function switchToApp(packageName: string): void {
  console.log(`Switching to app: ${packageName}`);
  runAdbCommand([
    "shell", "monkey", "-p", packageName,
    "-c", "android.intent.category.LAUNCHER", "1",
  ]);
}

/**
 * Executes a full workflow: a sequence of sub-goals with optional app switching.
 */
export async function runWorkflow(workflow: Workflow): Promise<WorkflowResult> {
  console.log(`\n========================================`);
  console.log(`Workflow: ${workflow.name}`);
  console.log(`Steps: ${workflow.steps.length}`);
  console.log(`========================================`);

  const results: StepResult[] = [];

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i];
    const total = workflow.steps.length;

    console.log(`\n--- Step ${i + 1}/${total}: ${step.goal} ---`);

    // Switch to target app if specified
    if (step.app) {
      switchToApp(step.app);
      await Bun.sleep(APP_LAUNCH_DELAY_MS);
    }

    // Build effective goal with form data
    const effectiveGoal = buildGoal(step);
    const maxSteps = step.maxSteps ?? DEFAULT_STEP_LIMIT;

    // Execute the sub-goal
    let result: StepResult;
    try {
      const agentResult = await runAgent(effectiveGoal, maxSteps);
      result = {
        goal: step.goal,
        app: step.app,
        success: agentResult.success,
        stepsUsed: agentResult.stepsUsed,
      };
    } catch (err) {
      result = {
        goal: step.goal,
        app: step.app,
        success: false,
        stepsUsed: 0,
        error: (err as Error).message,
      };
    }

    results.push(result);

    const status = result.success ? "completed" : "failed";
    console.log(`\nStep ${i + 1} ${status} (${result.stepsUsed} steps used)`);
  }

  const allSuccess = results.every((r) => r.success);
  return { name: workflow.name, steps: results, success: allSuccess };
}

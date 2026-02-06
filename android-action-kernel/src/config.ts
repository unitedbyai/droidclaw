/**
 * Configuration management for Android Action Kernel.
 * Bun natively loads .env files — no dotenv needed.
 */

import {
  DEVICE_DUMP_PATH,
  LOCAL_DUMP_PATH,
  DEVICE_SCREENSHOT_PATH,
  LOCAL_SCREENSHOT_PATH,
  DEFAULT_MAX_STEPS,
  DEFAULT_STEP_DELAY,
  DEFAULT_GROQ_MODEL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_BEDROCK_MODEL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_STUCK_THRESHOLD,
  DEFAULT_VISION_ENABLED,
} from "./constants.js";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const Config = {
  // ADB Configuration
  ADB_PATH: env("ADB_PATH", "adb"),
  SCREEN_DUMP_PATH: DEVICE_DUMP_PATH,
  LOCAL_DUMP_PATH: LOCAL_DUMP_PATH,
  DEVICE_SCREENSHOT_PATH: DEVICE_SCREENSHOT_PATH,
  LOCAL_SCREENSHOT_PATH: LOCAL_SCREENSHOT_PATH,

  // Agent Configuration
  MAX_STEPS: parseInt(env("MAX_STEPS", String(DEFAULT_MAX_STEPS)), 10),
  STEP_DELAY: parseFloat(env("STEP_DELAY", String(DEFAULT_STEP_DELAY))),
  MAX_RETRIES: parseInt(env("MAX_RETRIES", String(DEFAULT_MAX_RETRIES)), 10),
  STUCK_THRESHOLD: parseInt(env("STUCK_THRESHOLD", String(DEFAULT_STUCK_THRESHOLD)), 10),

  // Vision fallback (when accessibility tree is empty)
  VISION_ENABLED: env("VISION_ENABLED", String(DEFAULT_VISION_ENABLED)) === "true",

  // LLM Provider: "groq", "openai", "bedrock", or "openrouter"
  LLM_PROVIDER: env("LLM_PROVIDER", "groq"),

  // Groq Configuration
  GROQ_API_KEY: env("GROQ_API_KEY"),
  GROQ_MODEL: env("GROQ_MODEL", DEFAULT_GROQ_MODEL),

  // OpenAI Configuration
  OPENAI_API_KEY: env("OPENAI_API_KEY"),
  OPENAI_MODEL: env("OPENAI_MODEL", DEFAULT_OPENAI_MODEL),

  // AWS Bedrock Configuration
  AWS_REGION: env("AWS_REGION", "us-east-1"),
  BEDROCK_MODEL: env("BEDROCK_MODEL", DEFAULT_BEDROCK_MODEL),

  // OpenRouter Configuration (via Vercel AI SDK)
  OPENROUTER_API_KEY: env("OPENROUTER_API_KEY"),
  OPENROUTER_MODEL: env("OPENROUTER_MODEL", "anthropic/claude-3.5-sonnet"),

  getModel(): string {
    const provider = Config.LLM_PROVIDER;
    if (provider === "groq") return Config.GROQ_MODEL;
    if (provider === "bedrock") return Config.BEDROCK_MODEL;
    if (provider === "openrouter") return Config.OPENROUTER_MODEL;
    return Config.OPENAI_MODEL;
  },

  validate(): void {
    const provider = Config.LLM_PROVIDER;
    if (provider === "groq" && !Config.GROQ_API_KEY) {
      throw new Error("GROQ_API_KEY is required when using Groq provider");
    }
    if (provider === "openai" && !Config.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required when using OpenAI provider");
    }
    if (provider === "openrouter" && !Config.OPENROUTER_API_KEY) {
      throw new Error("OPENROUTER_API_KEY is required when using OpenRouter provider");
    }
    // Bedrock uses AWS credential chain, no explicit validation needed
  },
};

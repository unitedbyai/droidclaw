/**
 * Configuration management for DroidClaw.
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
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_STUCK_THRESHOLD,
  DEFAULT_MAX_ELEMENTS,
  DEFAULT_LOG_DIR,
  DEFAULT_VISION_MODE,
  DEFAULT_MAX_HISTORY_STEPS,
  DEFAULT_STREAMING_ENABLED,
  type VisionMode,
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

  // Vision mode: "off" | "fallback" (only when tree empty) | "always" (every step)
  VISION_MODE: (env("VISION_MODE", DEFAULT_VISION_MODE) as VisionMode),

  // Smart element filtering
  MAX_ELEMENTS: parseInt(env("MAX_ELEMENTS", String(DEFAULT_MAX_ELEMENTS)), 10),

  // Session logging
  LOG_DIR: env("LOG_DIR", DEFAULT_LOG_DIR),

  // Multi-turn memory
  MAX_HISTORY_STEPS: parseInt(env("MAX_HISTORY_STEPS", String(DEFAULT_MAX_HISTORY_STEPS)), 10),

  // Streaming responses
  STREAMING_ENABLED: env("STREAMING_ENABLED", String(DEFAULT_STREAMING_ENABLED)) === "true",

  // Optional host-side web access; device-based search remains the default.
  WEB_SEARCH_PROVIDER: env("WEB_SEARCH_PROVIDER", "device"),
  WEB_SEARCH_TIMEOUT_MS: Number(env("WEB_SEARCH_TIMEOUT_MS", "30000")),

  // LLM Provider: "groq", "openai", "bedrock", "openrouter", or "ollama"
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

  // Ollama Configuration (local LLMs, no API key needed)
  OLLAMA_BASE_URL: env("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
  OLLAMA_MODEL: env("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL),

  getModel(): string {
    const provider = Config.LLM_PROVIDER;
    if (provider === "groq") return Config.GROQ_MODEL;
    if (provider === "bedrock") return Config.BEDROCK_MODEL;
    if (provider === "openrouter") return Config.OPENROUTER_MODEL;
    if (provider === "ollama") return Config.OLLAMA_MODEL;
    return Config.OPENAI_MODEL;
  },

  validate(): void {
    if (!["device", "parallel", "none"].includes(Config.WEB_SEARCH_PROVIDER)) {
      throw new Error("WEB_SEARCH_PROVIDER must be device, parallel, or none");
    }
    if (!Number.isSafeInteger(Config.WEB_SEARCH_TIMEOUT_MS) || Config.WEB_SEARCH_TIMEOUT_MS <= 0) {
      throw new Error("WEB_SEARCH_TIMEOUT_MS must be a positive integer");
    }
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

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export type ProviderName = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'ollama-local';

export type QashConfig = {
  enabled: boolean;
  provider: ProviderName | null;
  actionTimeoutMs: number;
  reportJsonPath: string;
  reportHtmlPath: string;
  cachePath: string;
  testDir: string;
  openai: { model?: string; apiKey?: string; baseUrl: string };
  anthropic: { model?: string; apiKey?: string };
  gemini: { model?: string; apiKey?: string; baseUrl: string };
  ollama: { model?: string; apiKey?: string; baseUrl: string };
  ollamaLocal: { model?: string; apiKey?: string; baseUrl: string };
};

function readJsonFile(filePath: string): any {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

// Reads `use.actionTimeout` out of a project's playwright.config.(ts|js) without
// requiring ts-node or a full config evaluation — the value is almost always a
// plain numeric literal, so a targeted regex is far more robust here than trying
// to `require()` a TypeScript file from inside a published package.
function resolveActionTimeoutFromPlaywrightConfig(): number | null {
  const candidates = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'];

  for (const candidate of candidates) {
    const filePath = path.resolve(candidate);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/actionTimeout\s*:\s*(\d+(?:_\d+)*)/);
      if (match) {
        return parseInt(match[1].replace(/_/g, ''), 10);
      }
    } catch {
      // Ignore unreadable config files and fall through to the default.
    }
  }

  return null;
}

const DEFAULT_ACTION_TIMEOUT_MS = 30_000;

let cached: QashConfig | null = null;

export function loadConfig(): QashConfig {
  if (cached) return cached;

  const fileConfig = readJsonFile(path.resolve('qash.config.json')) || {};
  const provider = (process.env.HEALER_PROVIDER || fileConfig.provider || null) as ProviderName | null;
  const enabledRaw = process.env.HEALER_ENABLED ?? fileConfig.enabled;
  const enabled = enabledRaw === undefined ? true : !['false', '0', false].includes(enabledRaw);

  cached = {
    enabled,
    provider,
    actionTimeoutMs: resolveActionTimeoutFromPlaywrightConfig() ?? fileConfig.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
    reportJsonPath: path.resolve(fileConfig.reportJsonPath || 'qash-heal-report.json'),
    reportHtmlPath: path.resolve(fileConfig.reportHtmlPath || 'qash-heal-report.html'),
    cachePath: path.resolve(fileConfig.cachePath || '.qash-cache.json'),
    testDir: fileConfig.testDir || 'tests',
    openai: {
      model: process.env.OPENAI_MODEL || fileConfig.openai?.model,
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    },
    anthropic: {
      model: process.env.ANTHROPIC_MODEL || fileConfig.anthropic?.model,
      apiKey: process.env.ANTHROPIC_API_KEY,
    },
    gemini: {
      model: process.env.GEMINI_MODEL || fileConfig.gemini?.model,
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl: process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
    },
    ollama: {
      model: process.env.OLLAMA_MODEL || fileConfig.ollama?.model,
      apiKey: process.env.OLLAMA_API_KEY,
      baseUrl: process.env.OLLAMA_BASE_URL || 'https://ollama.com',
    },
    ollamaLocal: {
      model: process.env.OLLAMA_LOCAL_MODEL || fileConfig.ollamaLocal?.model,
      apiKey: process.env.OLLAMA_LOCAL_API_KEY,
      baseUrl: process.env.OLLAMA_LOCAL_BASE_URL || 'http://localhost:11434',
    },
  };

  return cached;
}

export function resetConfigCache() {
  cached = null;
}

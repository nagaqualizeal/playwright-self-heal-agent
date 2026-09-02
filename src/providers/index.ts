import { loadConfig } from '../core/config';
import { HealProvider } from './types';
import { OpenAiProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import { OllamaLocalProvider } from './ollamaLocal';

const instances: Record<string, HealProvider> = {
  openai: new OpenAiProvider(),
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider(),
  ollama: OllamaProvider,
  'ollama-local': OllamaLocalProvider,
};

export function getActiveProvider(): HealProvider | null {
  const { enabled, provider } = loadConfig();
  if (!enabled || !provider) return null;
  return instances[provider] || null;
}

export function getProviderByName(name: string): HealProvider | null {
  return instances[name] || null;
}

export { HealProvider } from './types';

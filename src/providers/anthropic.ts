import { loadConfig } from '../core/config';
import { HealProvider, HealPromptPayload, LocatorSuggestion } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, extractJsonArray } from './prompt';

const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export class AnthropicProvider implements HealProvider {
  async suggestLocators(payload: HealPromptPayload): Promise<LocatorSuggestion[]> {
    const { anthropic, actionTimeoutMs } = loadConfig();
    if (!anthropic.apiKey || !anthropic.model) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), actionTimeoutMs);

    try {
      const response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': anthropic.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: anthropic.model,
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(payload) }],
        }),
      });

      if (!response.ok) return [];
      const data: any = await response.json();
      const text = data.content?.[0]?.text || '';
      return extractJsonArray(text);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async checkConnectivity(timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
    const { anthropic } = loadConfig();
    if (!anthropic.apiKey) return { ok: false, detail: 'ANTHROPIC_API_KEY is not set.' };
    if (!anthropic.model) return { ok: false, detail: 'ANTHROPIC_MODEL is not set.' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-api-key': anthropic.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
        body: JSON.stringify({ model: anthropic.model, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      });
      if (response.ok) return { ok: true, detail: `Reached Anthropic with model ${anthropic.model}.` };
      const body = await response.text();
      return { ok: false, detail: `Anthropic responded ${response.status}: ${body.slice(0, 200)}` };
    } catch (e: any) {
      return { ok: false, detail: e.name === 'AbortError' ? `Timed out after ${timeoutMs}ms.` : e.message };
    } finally {
      clearTimeout(timer);
    }
  }
}

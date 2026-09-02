import { loadConfig } from '../core/config';
import { HealProvider, HealPromptPayload, LocatorSuggestion } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, extractJsonArray } from './prompt';

type OllamaSettings = { model?: string; apiKey?: string; baseUrl: string };

export function createOllamaProvider(getSettings: () => OllamaSettings, missingModelEnv: string, missingKeyIsFatal: boolean): HealProvider {
  function headers(settings: OllamaSettings): Record<string, string> {
    const base = { 'Content-Type': 'application/json' };
    return settings.apiKey ? { ...base, Authorization: `Bearer ${settings.apiKey}` } : base;
  }

  return {
    async suggestLocators(payload: HealPromptPayload): Promise<LocatorSuggestion[]> {
      const settings = getSettings();
      const { actionTimeoutMs } = loadConfig();
      if (!settings.model) return [];
      if (missingKeyIsFatal && !settings.apiKey) return [];

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), actionTimeoutMs);

      try {
        const response = await fetch(`${settings.baseUrl}/api/chat`, {
          method: 'POST',
          signal: controller.signal,
          headers: headers(settings),
          body: JSON.stringify({
            model: settings.model,
            stream: false,
            format: 'json',
            options: { temperature: 0 },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: buildUserPrompt(payload) },
            ],
          }),
        });

        if (!response.ok) return [];
        const data: any = await response.json();
        const text = data.message?.content || '';
        return extractJsonArray(text);
      } catch {
        return [];
      } finally {
        clearTimeout(timer);
      }
    },

    async checkConnectivity(timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
      const settings = getSettings();
      if (!settings.model) return { ok: false, detail: `${missingModelEnv} is not set.` };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(`${settings.baseUrl}/api/chat`, {
          method: 'POST',
          signal: controller.signal,
          headers: headers(settings),
          body: JSON.stringify({ model: settings.model, stream: false, messages: [{ role: 'user', content: 'ping' }] }),
        });
        if (response.ok) return { ok: true, detail: `Reached ${settings.baseUrl} with model ${settings.model}.` };
        const body = await response.text();
        return { ok: false, detail: `${settings.baseUrl} responded ${response.status}: ${body.slice(0, 200)}` };
      } catch (e: any) {
        return { ok: false, detail: e.name === 'AbortError' ? `Timed out after ${timeoutMs}ms.` : e.message };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

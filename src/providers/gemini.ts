import { loadConfig } from '../core/config';
import { HealProvider, HealPromptPayload, LocatorSuggestion } from './types';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt';

// Gemini's OpenAI-compatibility endpoint accepts the same request shape as
// OpenAI's chat completions API, so this is intentionally near-identical to
// openai.ts rather than using Gemini's native API shape.
export class GeminiProvider implements HealProvider {
  async suggestLocators(payload: HealPromptPayload): Promise<LocatorSuggestion[]> {
    const { gemini, actionTimeoutMs } = loadConfig();
    if (!gemini.apiKey || !gemini.model) return [];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), actionTimeoutMs);

    try {
      const response = await fetch(`${gemini.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${gemini.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: gemini.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT + ' Respond with a JSON object of shape { "suggestions": [...] }.' },
            { role: 'user', content: buildUserPrompt(payload) },
          ],
        }),
      });

      if (!response.ok) return [];
      const data: any = await response.json();
      const text = data.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : parsed.suggestions || [];
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }

  async checkConnectivity(timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
    const { gemini } = loadConfig();
    if (!gemini.apiKey) return { ok: false, detail: 'GEMINI_API_KEY is not set.' };
    if (!gemini.model) return { ok: false, detail: 'GEMINI_MODEL is not set.' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${gemini.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${gemini.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: gemini.model, max_tokens: 5, messages: [{ role: 'user', content: 'ping' }] }),
      });
      if (response.ok) return { ok: true, detail: `Reached Gemini with model ${gemini.model}.` };
      const body = await response.text();
      return { ok: false, detail: `Gemini responded ${response.status}: ${body.slice(0, 200)}` };
    } catch (e: any) {
      return { ok: false, detail: e.name === 'AbortError' ? `Timed out after ${timeoutMs}ms.` : e.message };
    } finally {
      clearTimeout(timer);
    }
  }
}

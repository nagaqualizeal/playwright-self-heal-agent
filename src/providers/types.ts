export type HealPromptPayload = {
  failedLocator: string;
  action: string;
  errorReason: string;
  description: string | null;
  ariaSnapshot: string;
  matchedElementAttributes?: Record<string, any> | null;
  similarElements?: { strategy: string; note?: string; details: any[] } | null;
};

export type LocatorSuggestion = {
  locator: string;
  confidence: number;
  reasoning: string;
};

export interface HealProvider {
  suggestLocators(payload: HealPromptPayload): Promise<LocatorSuggestion[]>;
  /** Makes one minimal real call to confirm the provider is reachable and configured correctly. */
  checkConnectivity(timeoutMs: number): Promise<{ ok: boolean; detail: string }>;
}

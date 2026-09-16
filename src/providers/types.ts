export type HealPromptPayload = {
  failedLocator: string;
  action: string;
  errorReason: string;
  description: string | null;
  ariaSnapshot: string;
  matchedElementAttributes?: Record<string, any> | null;
  similarElements?: { strategy: string; note?: string; details: any[] } | null;
};

// Exactly one of `locator`/`ref` is expected per suggestion. `ref` points at a node id from a
// mode:'ai' accessibility snapshot ([ref=eN]) and resolves via Playwright's own `aria-ref=` locator
// engine — the literal node the snapshot walker enumerated, not a hand-written guess. `locator` is
// the older, more error-prone shape: a full Playwright locator string the model wrote itself.
export type LocatorSuggestion = {
  locator?: string;
  ref?: string;
  confidence: number;
  reasoning: string;
};

export type VisionPromptPayload = {
  imageBase64: string;
  action: string;
  failedLocator: string;
  description: string | null;
};

// Normalized to a 0-1000 scale on each axis (rather than raw pixels) so the point is meaningful
// regardless of the screenshot's actual pixel dimensions or the model's own image-tiling/resizing —
// the caller multiplies back by the real captured width/height to get a document-relative pixel.
export type VisionPoint = { x: number; y: number };

export interface HealProvider {
  suggestLocators(payload: HealPromptPayload): Promise<LocatorSuggestion[]>;
  /** Makes one minimal real call to confirm the provider is reachable and configured correctly. */
  checkConnectivity(timeoutMs: number): Promise<{ ok: boolean; detail: string }>;
  /** True only for a provider whose `suggestElementFromImage` is actually implemented. */
  supportsVision?: boolean;
  /** Only present when `supportsVision` is true. Returns null when nothing plausibly matches. */
  suggestElementFromImage?(payload: VisionPromptPayload): Promise<VisionPoint | null>;
}

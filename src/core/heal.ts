import { Page, Locator, FrameLocator } from '@playwright/test';
import { classifyFailure } from './analyze';
import { getCachedHeal, saveHeal, invalidateCachedHeal } from './cache';
import { extractDescribedLabel, inferDescriptionFromVariableName, extractVariableNameFromSourceLine } from './describe';
import { extractLocatorIntent, findSimilarElements } from './elementSearch';
import { resolveLocator } from './locatorResolver';
import { validateLocator, ValidationMode } from './validate';
import { logHeal, HealAttempt } from './report';
import { getActiveProvider } from '../providers';
import { RuleBasedProvider } from '../providers/ruleBased';
import { LocatorSuggestion } from '../providers/types';
import { SourceLocation, formatSourceLocation } from './sourceLocation';
import { runHealedAction } from './actionRecovery';
import { HealProvider } from '../providers/types';
import { captureFullPageScreenshot, tagElementAtVisionPoint, visionTagSelector, cleanupVisionTag } from './vision';
import { SHORT_TIMEOUT } from './executeAction';
import { deriveDurableLocator } from './durableLocator';

export type CacheProbeRequest = {
  page: Page;
  target: Page | FrameLocator;
  originalLocator: Locator;
  method: string;
  args: any[];
  sourceLocation: SourceLocation | null;
  testName: string;
};

export type HealRequest = CacheProbeRequest & {
  error: any;
  actionOptions?: { state?: string };
};

function describeFailure(locator: Locator, location: SourceLocation | null) {
  const originalSelectorText = (locator as any)._selector || '';
  const describedLabel = extractDescribedLabel(originalSelectorText);
  const inferredLabel = !describedLabel && location
    ? inferDescriptionFromVariableName(extractVariableNameFromSourceLine(location.file, location.line))
    : null;
  return { originalSelectorText, description: describedLabel || inferredLabel };
}

// Semantic locators (getByRole/getByText/getByLabel/...) track the accessible tree rather than
// implementation details, so they're inherently less fragile than a raw CSS/XPath selector — see
// resolveLocator's own preference for them. A heal that fell back to CSS/XPath anyway is a weaker
// fix worth a human glance, same as one only found via a multi-match "best guess" or one the source
// itself wasn't confident about.
const SEMANTIC_LOCATOR_RE = /\.(getByRole|getByText|getByLabel|getByPlaceholder|getByTestId|getByAltText|getByTitle)\(/;
const LOW_CONFIDENCE_THRESHOLD = 0.6;

function evaluateReviewNeed(params: {
  locator: string;
  confidence?: number;
  mode?: 'strict' | 'relaxed';
  derivationQuality?: 'strong' | 'weak';
}): { needsReview: boolean; reviewReason?: string } {
  const reasons: string[] = [];
  if (params.mode === 'relaxed') {
    reasons.push('multiple elements matched on the page; a best-candidate guess was used');
  }
  if (params.confidence !== undefined && params.confidence < LOW_CONFIDENCE_THRESHOLD) {
    reasons.push(`low confidence (${Math.round(params.confidence * 100)}%)`);
  }
  if (!SEMANTIC_LOCATOR_RE.test(params.locator)) {
    reasons.push('healed to a CSS/XPath selector rather than a semantic locator');
  }
  if (params.derivationQuality === 'weak') {
    reasons.push('the confirmed element had no strong identity (role/name, test id, or placeholder) to derive a durable selector from');
  }
  return reasons.length > 0 ? { needsReview: true, reviewReason: reasons.join('; ') } : { needsReview: false };
}

async function getMatchedElementAttributes(locator: Locator): Promise<Record<string, any> | null> {
  try {
    const count = await locator.count();
    if (count === 0) return null;
    return await locator.first().evaluate((el: any) => ({
      tag: el.tagName?.toLowerCase(),
      id: el.id || null,
      className: el.className || null,
      role: el.getAttribute('role') || null,
      name: el.getAttribute('name') || null,
      placeholder: el.getAttribute('placeholder') || null,
      type: el.getAttribute('type') || null,
      dataTestId: el.getAttribute('data-testid') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      text: (el.innerText || '').slice(0, 100) || null,
    }));
  } catch {
    return null;
  }
}

function scriptFailureReason(error: any): string {
  if (!error) return 'Element not found on page.';
  const message = String(error.message || '');
  if (message.includes('strict mode')) return 'Strict mode violation: multiple elements matched.';
  if (message.toLowerCase().includes('timeout')) return 'Timeout: element never appeared or never became actionable.';
  return message.split('\n')[0] || 'Element not found.';
}

// Checked BEFORE an action is even attempted (not just after it fails), so a
// cache hit skips the original action's full timeout wait entirely rather
// than only skipping the AI call once that wait has already elapsed.
export async function tryHealFromCache(req: CacheProbeRequest): Promise<{ ok: true; result: any } | { ok: false }> {
  const location = req.sourceLocation;
  const { originalSelectorText, description } = describeFailure(req.originalLocator, location);

  const cached = getCachedHeal(originalSelectorText, location);
  if (!cached) return { ok: false };

  const candidate = resolveLocator(req.target, cached.healed);
  const result = await validateLocator(candidate, ValidationMode.RELAXED, description);

  if (result.valid && result.resolvedLocator) {
    // Runs (and, if enabled, recovers) the action before logging/trusting the cache hit — a
    // locator that resolves but still can't be acted on even after recovery isn't a working fix,
    // so it falls through to invalidation + the normal original-locator-then-heal path below
    // instead of crashing the test outright.
    const actionOutcome = await runHealedAction(result.resolvedLocator, req.method, req.args);
    if (actionOutcome.ok) {
      const { needsReview, reviewReason } = evaluateReviewNeed({
        locator: cached.healed,
        confidence: cached.confidence,
        mode: cached.mode,
      });
      await logHeal({
        original: originalSelectorText,
        healed: cached.healed,
        status: 'cache_hit',
        strategy: 'cache',
        action: req.method,
        test: req.testName,
        pageUrl: req.page.url(),
        location: formatSourceLocation(location),
        sourceFile: location?.file,
        sourceLine: location?.line,
        description,
        needsReview: needsReview || actionOutcome.usedActionRecovery,
        reviewReason: actionOutcome.usedActionRecovery
          ? [reviewReason, `action required recovery (tactic: ${actionOutcome.tactic})`].filter(Boolean).join('; ')
          : reviewReason,
        usedActionRecovery: actionOutcome.usedActionRecovery,
        actionRecoveryTactic: actionOutcome.tactic,
      });
      return { ok: true, result: actionOutcome.result };
    }
  }

  invalidateCachedHeal(originalSelectorText, location);
  return { ok: false };
}

type AttemptContext = {
  req: HealRequest;
  description: string | null;
  originalSelectorText: string;
  location: SourceLocation | null;
  locationLabel: string;
  pageUrl: string;
  attempts: HealAttempt[];
};

// Runs one suggestion list through the same strict-then-relaxed validation used for both the
// rule-based pass and the AI pass — `strategyLabel` ('rule' | 'llm') is what tells them apart in
// the report. Executes and logs success as soon as one candidate resolves; otherwise records every
// rejection into `ctx.attempts` and lets the caller decide what to try next.
async function attemptSuggestions(
  suggestions: LocatorSuggestion[],
  strategyLabel: 'rule' | 'llm',
  ctx: AttemptContext
): Promise<{ handled: true; result: any } | { handled: false }> {
  for (const mode of [ValidationMode.STRICT, ValidationMode.RELAXED]) {
    const passLabel = mode === ValidationMode.STRICT ? 'strict' : 'relaxed';
    for (const suggestion of suggestions) {
      // A ref resolves via Playwright's own `aria-ref=` locator engine — the literal node a
      // mode:'ai' snapshot enumerated, not a string the model reconstructed from memory. `locator`
      // is the older, more error-prone shape: a full Playwright locator string the model wrote
      // itself. Exactly one of the two is expected; a suggestion with neither is skipped.
      const displayLocator = suggestion.ref ? `aria-ref=${suggestion.ref}` : suggestion.locator;
      if (!displayLocator) continue;

      try {
        const candidate = suggestion.ref
          ? ctx.req.target.locator(`aria-ref=${suggestion.ref}`)
          : resolveLocator(ctx.req.target, suggestion.locator!);
        const result = await validateLocator(candidate, mode, ctx.description);
        ctx.attempts.push({
          strategy: `${strategyLabel}-${passLabel}`,
          locator: displayLocator,
          result: result.valid ? 'success' : 'failed',
          count: result.elementCount,
          reason: result.valid
            ? undefined
            : mode === ValidationMode.STRICT
            ? result.duplicates
              ? 'Multiple matches in strict mode'
              : 'No match'
            : 'No usable match',
        });

        if (result.valid && result.resolvedLocator) {
          // Run (and, if enabled, recover) the action before trusting/logging/caching this
          // candidate as a real success — a locator that resolves but still can't be acted on even
          // after recovery isn't a working fix, so it falls through and the next candidate (or the
          // next validation pass) gets a chance instead of the whole heal blowing up here.
          const actionOutcome = await runHealedAction(result.resolvedLocator, ctx.req.method, ctx.req.args);
          if (!actionOutcome.ok) {
            ctx.attempts.push({
              strategy: `${strategyLabel}-${passLabel}`,
              locator: displayLocator,
              result: 'failed',
              count: result.elementCount,
              reason: `Locator resolved but the action still failed: ${actionOutcome.error?.message?.split('\n')[0]}`,
            });
            continue;
          }

          // A `locator` suggestion already IS a durable, portable string — cache it as-is. A `ref`
          // hit is only valid for this page load, so it has to be turned into something durable
          // from the confirmed element's own real attributes before there's anything worth saving.
          let healedCode: string | null = suggestion.locator ?? null;
          let derivationQuality: 'strong' | 'weak' | undefined;
          if (suggestion.ref) {
            const derived = await deriveDurableLocator(result.resolvedLocator);
            if (derived) {
              healedCode = derived.code;
              derivationQuality = derived.quality;
            }
          }

          const { needsReview: baseNeedsReview, reviewReason: baseReviewReason } = healedCode
            ? evaluateReviewNeed({ locator: healedCode, confidence: suggestion.confidence, mode: passLabel, derivationQuality })
            : {
                needsReview: true,
                reviewReason: 'resolved via aria-ref, but no durable selector could be derived from the element — not cached',
              };

          if (healedCode) {
            saveHeal(ctx.originalSelectorText, ctx.location, healedCode, {
              confidence: suggestion.confidence,
              mode: passLabel,
            });
          }

          await logHeal({
            original: ctx.originalSelectorText,
            healed: healedCode ?? `${displayLocator} (no durable selector derived; not cached)`,
            status: 'success',
            strategy: strategyLabel,
            action: ctx.req.method,
            test: ctx.req.testName,
            pageUrl: ctx.pageUrl,
            location: ctx.locationLabel,
            sourceFile: ctx.location?.file,
            sourceLine: ctx.location?.line,
            description: ctx.description,
            needsReview: baseNeedsReview || actionOutcome.usedActionRecovery,
            reviewReason: actionOutcome.usedActionRecovery
              ? [baseReviewReason, `action required recovery (tactic: ${actionOutcome.tactic})`].filter(Boolean).join('; ')
              : baseReviewReason,
            usedActionRecovery: actionOutcome.usedActionRecovery,
            actionRecoveryTactic: actionOutcome.tactic,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            attempts: ctx.attempts,
          });
          return { handled: true, result: actionOutcome.result };
        }
      } catch (e: any) {
        ctx.attempts.push({ strategy: `${strategyLabel}-${passLabel}`, locator: displayLocator, result: 'failed', reason: e.message });
      }
    }
  }
  return { handled: false };
}

// Last resort, only reached after both the rule-based and AI text passes have already failed to
// find anything usable — for elements the accessibility tree doesn't describe well (canvas-drawn
// UI, an icon with no accessible name). Scoped to the main page (see vision.ts) and to whichever
// configured provider actually implements suggestElementFromImage. The tag a vision hit resolves to
// is random and removed right after — deriveDurableLocator (the same step the ref-based text path
// uses) is what turns that one-off tag into something worth caching, when the element's own
// attributes support it.
async function tryVisionFallback(
  provider: HealProvider,
  req: HealRequest,
  ctx: AttemptContext
): Promise<{ handled: true; result: any } | { handled: false }> {
  if (!provider.supportsVision || !provider.suggestElementFromImage) return { handled: false };
  if (typeof (req.target as any).screenshot !== 'function') return { handled: false }; // inside an <iframe> — out of scope

  const captured = await captureFullPageScreenshot(req.page, SHORT_TIMEOUT * 5);
  if (!captured) return { handled: false };

  const point = await provider.suggestElementFromImage({
    imageBase64: captured.imageBase64,
    action: req.method,
    failedLocator: ctx.originalSelectorText,
    description: ctx.description,
  });
  if (!point) {
    ctx.attempts.push({ strategy: 'vision', locator: '(screenshot)', result: 'failed', reason: 'AI found nothing in the screenshot plausibly matching the description.' });
    return { handled: false };
  }

  const tagId = await tagElementAtVisionPoint(req.page, point, captured);
  if (!tagId) {
    ctx.attempts.push({ strategy: 'vision', locator: '(screenshot)', result: 'failed', reason: 'AI pointed at a location in the screenshot, but no real element could be resolved there.' });
    return { handled: false };
  }

  const taggedLocator = req.page.locator(visionTagSelector(tagId));
  const result = await validateLocator(taggedLocator, ValidationMode.STRICT, ctx.description);
  if (!result.valid || !result.resolvedLocator) {
    await cleanupVisionTag(req.page, tagId);
    ctx.attempts.push({ strategy: 'vision', locator: '(screenshot)', result: 'failed', reason: 'Tagged element was no longer resolvable.' });
    return { handled: false };
  }

  // Derive before cleanup — the durable-locator step needs to read the real element's own
  // attributes, which only makes sense while the tag (and the element itself) is still live.
  const derived = await deriveDurableLocator(result.resolvedLocator).catch(() => null);
  const actionOutcome = await runHealedAction(result.resolvedLocator, req.method, req.args);
  await cleanupVisionTag(req.page, tagId);
  if (!actionOutcome.ok) {
    ctx.attempts.push({ strategy: 'vision', locator: '(screenshot)', result: 'failed', reason: `Found a visual match, but acting on it failed too: ${actionOutcome.error?.message?.split('\n')[0]}` });
    return { handled: false };
  }

  if (derived) {
    saveHeal(ctx.originalSelectorText, ctx.location, derived.code);
  }

  await logHeal({
    original: ctx.originalSelectorText,
    healed: derived ? derived.code : '(vision match — no durable selector derived; not cached)',
    status: 'success',
    strategy: 'vision',
    action: req.method,
    test: req.testName,
    pageUrl: ctx.pageUrl,
    location: ctx.locationLabel,
    sourceFile: ctx.location?.file,
    sourceLine: ctx.location?.line,
    description: ctx.description,
    needsReview: true,
    reviewReason: derived
      ? `resolved via screenshot analysis; derived a ${derived.quality} selector from the confirmed element for future runs`
      : 'resolved via screenshot analysis, not the accessibility tree — no durable selector could be derived, so nothing was cached',
    usedActionRecovery: actionOutcome.usedActionRecovery,
    actionRecoveryTactic: actionOutcome.tactic,
    attempts: ctx.attempts,
  });
  return { handled: true, result: actionOutcome.result };
}

export async function heal(req: HealRequest): Promise<any> {
  const classification = classifyFailure(req.error, req.method, req.actionOptions);
  if (classification !== 'heal') {
    throw req.error;
  }

  const location = req.sourceLocation;
  const locationLabel = formatSourceLocation(location);
  const { originalSelectorText, description } = describeFailure(req.originalLocator, location);

  const attempts: HealAttempt[] = [];
  const pageUrl = req.page.url();

  // ---- Gather context (needed by both the free rule-based pass and the AI pass) ----
  // mode: 'ai' tags every node with a [ref=eN] id (see prompt.ts) so the AI provider can point at
  // the literal node it read instead of reconstructing a locator string from memory. The
  // rule-based provider's own line parser only reads the leading `role "name"` of each line, so
  // the trailing ref marker doesn't affect it.
  let ariaSnapshot = '';
  try {
    ariaSnapshot = await req.target.locator('body').ariaSnapshot({ mode: 'ai' });
  } catch {
    // Some frames/pages may not expose a body snapshot; proceed with an empty one.
  }

  const matchedElementAttributes = await getMatchedElementAttributes(req.originalLocator);
  const similarElements = matchedElementAttributes
    ? null
    : await findSimilarElements(req.target, extractLocatorIntent(originalSelectorText)).catch(() => null);

  const promptPayload = {
    failedLocator: originalSelectorText,
    action: req.method,
    errorReason: scriptFailureReason(req.error),
    description,
    ariaSnapshot,
    matchedElementAttributes,
    similarElements,
  };

  const ctx: AttemptContext = { req, description, originalSelectorText, location, locationLabel, pageUrl, attempts };

  // ---- Free pass: rule-based text matching, before spending anything on AI ----
  const ruleSuggestions = await RuleBasedProvider.suggestLocators(promptPayload).catch(() => []);
  if (ruleSuggestions.length > 0) {
    const ruleOutcome = await attemptSuggestions(ruleSuggestions, 'rule', ctx);
    if (ruleOutcome.handled) return ruleOutcome.result;
  }

  const provider = getActiveProvider();
  if (!provider) {
    await logHeal({
      original: originalSelectorText,
      status: 'failed',
      strategy: 'none',
      action: req.method,
      test: req.testName,
      pageUrl,
      location: locationLabel,
      sourceFile: location?.file,
      sourceLine: location?.line,
      description,
      attempts,
      finalFailureReason:
        attempts.length > 0
          ? 'Rule-based matching found no confident match, and no AI provider is configured (HEALER_ENABLED/HEALER_PROVIDER).'
          : 'No AI provider configured (HEALER_ENABLED/HEALER_PROVIDER).',
    });
    throw req.error;
  }

  const suggestions = await provider.suggestLocators(promptPayload);
  const llmOutcome = await attemptSuggestions(suggestions, 'llm', ctx);
  if (llmOutcome.handled) return llmOutcome.result;

  // ---- Last resort: screenshot analysis, only for a provider that supports it ----
  const visionOutcome = await tryVisionFallback(provider, req, ctx);
  if (visionOutcome.handled) return visionOutcome.result;

  await logHeal({
    original: originalSelectorText,
    status: 'failed',
    strategy: 'llm',
    action: req.method,
    test: req.testName,
    pageUrl,
    location: locationLabel,
    sourceFile: location?.file,
    sourceLine: location?.line,
    description,
    attempts,
    finalFailureReason: 'No suggested locator resolved to a usable element.',
  });

  throw req.error;
}

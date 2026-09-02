import { Page, Locator, FrameLocator } from '@playwright/test';
import { classifyFailure } from './analyze';
import { getCachedHeal, saveHeal, invalidateCachedHeal } from './cache';
import { extractDescribedLabel, inferDescriptionFromVariableName, extractVariableNameFromSourceLine } from './describe';
import { extractLocatorIntent, findSimilarElements } from './elementSearch';
import { resolveLocator } from './locatorResolver';
import { validateLocator, ValidationMode } from './validate';
import { logHeal, HealAttempt } from './report';
import { getActiveProvider } from '../providers';
import { SourceLocation, formatSourceLocation } from './sourceLocation';

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

const SHORT_TIMEOUT = 2000;

function describeFailure(locator: Locator, location: SourceLocation | null) {
  const originalSelectorText = (locator as any)._selector || '';
  const describedLabel = extractDescribedLabel(originalSelectorText);
  const inferredLabel = !describedLabel && location
    ? inferDescriptionFromVariableName(extractVariableNameFromSourceLine(location.file, location.line))
    : null;
  return { originalSelectorText, description: describedLabel || inferredLabel };
}

async function executeAction(locator: Locator, method: string, args: any[]): Promise<any> {
  const fn = (locator as any)[method];
  if (typeof fn !== 'function') throw new Error(`Unsupported action for healing: ${method}`);

  const lastArg = args[args.length - 1];
  const hasOptionsObject = lastArg && typeof lastArg === 'object' && !Array.isArray(lastArg);
  const callArgs = hasOptionsObject
    ? [...args.slice(0, -1), { ...lastArg, timeout: SHORT_TIMEOUT }]
    : [...args, { timeout: SHORT_TIMEOUT }];

  return fn.apply(locator, callArgs);
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

  const candidate = resolveLocator(req.target, cached);
  const result = await validateLocator(candidate, ValidationMode.RELAXED, description);

  if (result.valid && result.resolvedLocator) {
    logHeal({
      original: originalSelectorText,
      healed: cached,
      status: 'cache_hit',
      strategy: 'cache',
      action: req.method,
      test: req.testName,
      pageUrl: req.page.url(),
      location: formatSourceLocation(location),
      sourceFile: location?.file,
      sourceLine: location?.line,
      description,
    });
    return { ok: true, result: await executeAction(result.resolvedLocator, req.method, req.args) };
  }

  invalidateCachedHeal(originalSelectorText, location);
  return { ok: false };
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

  const provider = getActiveProvider();
  if (!provider) {
    logHeal({
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
      finalFailureReason: 'No AI provider configured (HEALER_ENABLED/HEALER_PROVIDER).',
    });
    throw req.error;
  }

  // ---- Gather context ----
  let ariaSnapshot = '';
  try {
    ariaSnapshot = await req.target.locator('body').ariaSnapshot();
  } catch {
    // Some frames/pages may not expose a body snapshot; proceed with an empty one.
  }

  const matchedElementAttributes = await getMatchedElementAttributes(req.originalLocator);
  const similarElements = matchedElementAttributes
    ? null
    : await findSimilarElements(req.target, extractLocatorIntent(originalSelectorText)).catch(() => null);

  const suggestions = await provider.suggestLocators({
    failedLocator: originalSelectorText,
    action: req.method,
    errorReason: scriptFailureReason(req.error),
    description,
    ariaSnapshot,
    matchedElementAttributes,
    similarElements,
  });

  // ---- Pass 1: strict (exact single match) ----
  for (const suggestion of suggestions) {
    try {
      const candidate = resolveLocator(req.target, suggestion.locator);
      const result = await validateLocator(candidate, ValidationMode.STRICT, description);
      attempts.push({
        strategy: 'llm-strict',
        locator: suggestion.locator,
        result: result.valid ? 'success' : 'failed',
        count: result.elementCount,
        reason: result.valid ? undefined : result.duplicates ? 'Multiple matches in strict mode' : 'No match',
      });

      if (result.valid && result.resolvedLocator) {
        saveHeal(originalSelectorText, location, suggestion.locator);
        logHeal({
          original: originalSelectorText,
          healed: suggestion.locator,
          status: 'success',
          strategy: 'llm',
          action: req.method,
          test: req.testName,
          pageUrl,
          location: locationLabel,
        sourceFile: location?.file,
        sourceLine: location?.line,
          description,
          confidence: suggestion.confidence,
          reasoning: suggestion.reasoning,
          attempts,
        });
        return executeAction(result.resolvedLocator, req.method, req.args);
      }
    } catch (e: any) {
      attempts.push({ strategy: 'llm-strict', locator: suggestion.locator, result: 'failed', reason: e.message });
    }
  }

  // ---- Pass 2: relaxed (best candidate among matches) ----
  for (const suggestion of suggestions) {
    try {
      const candidate = resolveLocator(req.target, suggestion.locator);
      const result = await validateLocator(candidate, ValidationMode.RELAXED, description);
      attempts.push({
        strategy: 'llm-relaxed',
        locator: suggestion.locator,
        result: result.valid ? 'success' : 'failed',
        count: result.elementCount,
        reason: result.valid ? undefined : 'No usable match',
      });

      if (result.valid && result.resolvedLocator) {
        saveHeal(originalSelectorText, location, suggestion.locator);
        logHeal({
          original: originalSelectorText,
          healed: suggestion.locator,
          status: 'success',
          strategy: 'llm',
          action: req.method,
          test: req.testName,
          pageUrl,
          location: locationLabel,
        sourceFile: location?.file,
        sourceLine: location?.line,
          description,
          confidence: suggestion.confidence,
          reasoning: suggestion.reasoning,
          attempts,
        });
        return executeAction(result.resolvedLocator, req.method, req.args);
      }
    } catch (e: any) {
      attempts.push({ strategy: 'llm-relaxed', locator: suggestion.locator, result: 'failed', reason: e.message });
    }
  }

  logHeal({
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

import { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { analyzeError } from './analyzer';
import { getLLMSuggestions } from './llmClient';
import { resolveLocator } from './resolver';
import { validateLocator } from './validator';
import { logHealing } from './reporter';

const cacheFile = path.resolve('.selfheal-cache.json');

// ================= CACHE HELPERS =================
function loadCache(): Record<string, string> {
  try {
    if (!fs.existsSync(cacheFile)) return {};

    const content = fs.readFileSync(cacheFile, 'utf-8');

    if (!content || content.trim() === '') {
      return {};
    }

    return JSON.parse(content);
  } catch (error) {
    console.log('⚠️ Cache corrupted → resetting');
    fs.writeFileSync(cacheFile, '{}');
    return {};
  }
}

function saveToCache(original: string, healed: string) {
  const cache = loadCache();
  cache[original] = healed;
  fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
}

// ================= MAIN =================
export async function handleHealing(
  page: Page,
  originalSelector: string,
  action: string,
  args: any[],
  error: any,
  actionId?: number,
  testName?: string
) {
  const type = analyzeError(error);

  if (type !== 'locator') {
    throw error;
  }

  console.log(`⚠️ [${actionId}] Healing triggered for: ${originalSelector}`);

  const attempts: any[] = [];

  // ================= CACHE =================
  const cache = loadCache();

  if (cache[originalSelector]) {
    console.log(`⚡ [${actionId}] Cache hit → ${cache[originalSelector]}`);

    const locator = resolveLocator(page, cache[originalSelector]);
    const isValid = await validateLocator(page, locator);

    attempts.push({
      strategy: 'cache',
      locator: cache[originalSelector],
      result: isValid ? 'success' : 'failed',
      reason: isValid ? '' : 'invalid cache locator'
    });

    if (isValid) {
      console.log(`✅ [${actionId}] Cache SUCCESS`);

      logHealing({
        original: originalSelector,
        healed: cache[originalSelector],
        strategy: 'cache',
        status: 'success',
        attempts,
        test: testName,
        action,
        confidence: 1
      });

      return await executeAction(locator, action, args);
    } else {
      console.log(`❌ [${actionId}] Cache FAILED → fallback`);
    }
  }

  // ================= RULE =================
  try {
    const text = extractTextFromSelector(originalSelector);

    if (text) {
      console.log(`🔍 [${actionId}] Rule-based trying: text=${text}`);

      const fallback = page.getByText(new RegExp(text, 'i'));
      const isValid = await validateLocator(page, fallback);

      attempts.push({
        strategy: 'rule',
        locator: `text=${text}`,
        result: isValid ? 'success' : 'failed',
        reason: isValid ? '' : 'not found or not unique'
      });

      if (isValid) {
        console.log(`✅ [${actionId}] Rule SUCCESS`);

        saveToCache(originalSelector, `text=${text}`);

        logHealing({
          original: originalSelector,
          healed: `text=${text}`,
          strategy: 'rule',
          status: 'success',
          attempts,
          test: testName,
          action,
          confidence: 1
        });

        return await executeAction(fallback, action, args);
      } else {
        console.log(`❌ [${actionId}] Rule FAILED`);
      }
    }
  } catch {
    console.log(`❌ [${actionId}] Rule ERROR`);
  }

  // ================= LLM =================
  try {
    console.log(`🤖 [${actionId}] Calling LLM...`);

    const dom = await page.content();

    const suggestions = await getLLMSuggestions({
      failedLocator: originalSelector,
      error: error?.message || 'not found',
      dom
    });

    console.log(`🧠 [${actionId}] LLM Suggestions:`, suggestions);

    for (const suggestion of suggestions) {
      try {
        const locator = resolveLocator(page, suggestion.locator);
        const isValid = await validateLocator(page, locator);

        attempts.push({
          strategy: 'llm',
          locator: suggestion.locator,
          result: isValid ? 'success' : 'failed',
          reason: isValid ? '' : 'validation failed'
        });

        if (isValid) {
          console.log(`✅ [${actionId}] LLM SUCCESS → ${suggestion.locator}`);

          // 🔥 SAVE TO CACHE
          saveToCache(originalSelector, suggestion.locator);

          logHealing({
            original: originalSelector,
            healed: suggestion.locator,
            strategy: 'llm',
            status: 'success',
            attempts,
            test: testName,
            action,
            confidence: suggestion.confidence
          });

          return await executeAction(locator, action, args);
        } else {
          console.log(`❌ [${actionId}] LLM rejected: ${suggestion.locator}`);
        }
      } catch {
        console.log(`❌ [${actionId}] LLM locator error`);
      }
    }

    console.log(`❌ [${actionId}] LLM FAILED`);

  } catch {
    console.log(`❌ [${actionId}] LLM SYSTEM ERROR`);
  }

  // ================= FINAL FAILURE =================
  console.log(`🚨 [${actionId}] Healing FAILED completely`);

  logHealing({
    original: originalSelector,
    strategy: 'all',
    status: 'failed',
    attempts,
    final: 'no valid locator found',
    test: testName,
    action,
    confidence: 0
  });

  throw error;
}

// ================= HELPERS =================

function extractTextFromSelector(selector: string): string | null {
  const match = selector.match(/login|submit|chat|checkout/i);
  return match ? match[0] : null;
}

async function executeAction(locator: any, action: string, args: any[]) {
  if (action === 'click') return await locator.first().click();
  if (action === 'fill') return await locator.first().fill(args[0]);
  throw new Error(`Unsupported action: ${action}`);
}
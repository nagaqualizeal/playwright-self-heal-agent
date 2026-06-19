import { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { analyzeError } from './analyzer';
import { getLLMSuggestions } from './llmClient';
import { resolveLocator } from './resolver';
import { validateLocator, ValidationMode } from './validator';
import { logHealing } from './reporter';
import { extractLocatorIntent, findTargetElement, extractElementDetails, generateSelectorSuggestions } from './locatorParser';

const cacheFile = path.resolve('.selfheal-cache.json');

// ================= CACHE HELPERS =================
export function loadCache(): Record<string, string> {
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
  try {
    console.log(`\n🔧 [${actionId}] === HEALING START ===`);
    console.log(`   Selector: ${originalSelector}`);
    console.log(`   Action: ${action}`);
    console.log(`   Error: ${error?.message?.split('\n')[0]}`);
    
    const type = analyzeError(error);
    console.log(`   Error type: ${type}`);

    if (type !== 'locator') {
      console.log(`   ❌ Not a locator error, skipping healing`);
      throw error;
    }

    console.log(`   ✅ Locator error detected, proceeding with healing`);

    // ================= RETRY WITH WAIT =================
    // Element might be loading/appearing after a previous action
    // The original action (click/fill) already waited 30 seconds with Playwright's built-in timeout
    // If we got here, it means the element truly failed to appear or interact
    // No need to wait again - go straight to healing
    console.log(`⚠️ [${actionId}] Element not found after 30s timeout. Triggering healing mechanism...`);

    // Determine why the script failed
    let scriptFailureReason = 'Unknown error';
    let failedLocatorElements: any[] = [];
    
    if (!error) {
      scriptFailureReason = 'Element not found on page (after 2s wait)';
    } else if (error.message?.includes('strict mode')) {
      scriptFailureReason = 'Strict mode violation: Multiple elements matched';
    } else if (error.message?.includes('not found')) {
      scriptFailureReason = 'Element not found: Locator returned no elements';
    } else if (error.message?.includes('timeout')) {
      scriptFailureReason = 'Timeout: Element interaction timed out';
    } else {
      scriptFailureReason = error.message || 'Script execution failed';
    }

    console.log(`⚠️ [${actionId}] Healing triggered for: ${originalSelector}`);
    console.log(`   ❌ Reason: ${scriptFailureReason}`);

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

  // ================= RULE (DISABLED - FOR FUTURE USE) =================
  // TODO: Enable this later if needed
  /*
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
  */

  // ================= LLM =================
  try {
    console.log(`\n🤖 [${actionId}] Extracting page context...`);

    // 🎯 Extract accessibility tree
    let ariaSnapshot: string = '';
    try {
      ariaSnapshot = await page.locator('body').ariaSnapshot();
      console.log(`   📋 Aria snapshot captured (${ariaSnapshot.length} chars)`);
      
      // ✅ NEW: Show aria snapshot content for debugging
      console.log(`\n   📊 === ARIA SNAPSHOT FULL CONTENT ===`);
      console.log(ariaSnapshot);
      console.log(`   === END ARIA SNAPSHOT ===\n`);
      
      // ✅ NEW: Search for buttons in aria-snapshot
      const buttonMatches = ariaSnapshot.match(/button[^:]*:\s*"[^"]*"/gi) || [];
      if (buttonMatches.length > 0) {
        console.log(`\n   🔍 Found ${buttonMatches.length} button(s) in aria-snapshot:`);
        buttonMatches.forEach((match, i) => {
          console.log(`      [${i + 1}] ${match}`);
        });
      } else {
        console.log(`\n   ⚠️  No buttons found in aria-snapshot!`);
      }
      
      // ✅ NEW: Search for specific text in snapshot
      if (originalSelector.includes('Change') || originalSelector.includes('Password')) {
        const searchTexts = ['Change', 'Password', 'change password', 'existing'];
        console.log(`\n   🔎 Searching for keywords in aria-snapshot:`);
        searchTexts.forEach(text => {
          const found = ariaSnapshot.toLowerCase().includes(text.toLowerCase());
          console.log(`      "${text}": ${found ? '✅ FOUND' : '❌ NOT FOUND'}`);
        });
      }
      
      console.log(`   === END ARIA SNAPSHOT ===\n`);
    } catch (e) {
      console.log(`   ⚠️  Aria snapshot failed: ${(e as any).message}`);
    }

    // 📸 Extract screenshot
    let screenshot: string | undefined;
    try {
      const buffer = await page.screenshot({ fullPage: true });
      screenshot = buffer.toString('base64');
      console.log(`   📸 Screenshot captured (${screenshot.length} chars)`);
    } catch (e) {
      console.log(`   ⚠️  Screenshot failed: ${(e as any).message}`);
    }

    // 🔍 Extract failed element context
    let failedElementSnapshot: string = '';
    let contextHtml: string = '';
    let elementCount: number = 0;
    let elementDetails: any = {};

    try {
      const failedLocator = page.locator(originalSelector);
      elementCount = await failedLocator.count();
      console.log(`   🔢 Original locator matches: ${elementCount} elements`);

      if (elementCount > 0) {
        // Get first element's aria snapshot
        failedElementSnapshot = await failedLocator.first().ariaSnapshot();

        // Get element HTML context
        contextHtml = await failedLocator.first().evaluate((el: any) => {
          const parent = el.parentElement;
          return parent ? parent.outerHTML.slice(0, 2000) : el.outerHTML.slice(0, 1000);
        });

        // Get element details - collect ALL useful attributes for fallback selectors
        elementDetails = await failedLocator.first().evaluate((el: any) => ({
          tagName: el.tagName,
          id: el.id || 'N/A',
          className: el.className || 'N/A',
          innerText: el.innerText?.slice(0, 100) || 'N/A',
          // Accessibility attributes
          ariaLabel: el.getAttribute('aria-label') || 'N/A',
          ariaLabelledBy: el.getAttribute('aria-labelledby') || 'N/A',
          role: el.getAttribute('role') || 'N/A',
          // Input field attributes
          name: el.getAttribute('name') || 'N/A',
          placeholder: el.getAttribute('placeholder') || 'N/A',
          type: el.getAttribute('type') || 'N/A',
          // Fallback selector attributes
          dataTestId: el.getAttribute('data-testid') || 'N/A',
          dataTest: el.getAttribute('data-test') || 'N/A',
          dataId: el.getAttribute('data-id') || 'N/A',
          value: el.getAttribute('value') || 'N/A',
          // For debugging - show what selectors might work
          possibleSelectors: {
            id: el.id ? `#${el.id}` : null,
            dataTestId: el.getAttribute('data-testid') ? `[data-testid="${el.getAttribute('data-testid')}"]` : null,
            dataTest: el.getAttribute('data-test') ? `[data-test="${el.getAttribute('data-test')}"]` : null,
            name: el.getAttribute('name') ? `[name="${el.getAttribute('name')}"]` : null,
            type: el.getAttribute('type') ? el.getAttribute('type') : null
          }
        }));

        // If multiple elements, get all details
        if (elementCount > 1) {
          const allElements = await failedLocator.all();
          failedLocatorElements = await Promise.all(
            allElements.map((el) =>
              el.evaluate((elem: any) => ({
                text: elem.innerText?.slice(0, 50) || 'N/A',
                className: elem.className,
                id: elem.id,
                name: elem.getAttribute('name'),
                role: elem.getAttribute('role')
              }))
            )
          );
          console.log(`   ⚠️  Multiple matching elements detected:`);
          failedLocatorElements.forEach((el, i) => {
            console.log(`      [${i + 1}] id="${el.id}" name="${el.name}" role="${el.role}" text="${el.text}"`);
          });
        }

        console.log(`   📝 Element details: tag=${elementDetails.tagName}, id=${elementDetails.id}, name=${elementDetails.name}, role=${elementDetails.role}`);
      } else {
        console.log(`   ⚠️  Failed locator not found on page (0 matches)`);
        
        // ✅ NEW: Use smart locator parser to find target element with fallback strategies
        try {
          console.log(`\n   🔍 === SMART ELEMENT SEARCH WITH FALLBACKS ===`);
          
          // Parse the locator to extract search intent (attribute name, value, text content, etc.)
          const intent = extractLocatorIntent(originalSelector);
          console.log(`   Extracted intent:`, intent);
          
          // Use fallback strategies to find the target element
          const searchResult = await findTargetElement(page, originalSelector, intent);
          
          if (searchResult) {
            console.log(`\n   ✅ FOUND target element using strategy: ${searchResult.strategy}`);
            if (searchResult.note) {
              console.log(`   ℹ️  Note: ${searchResult.note}`);
            }
            
            elementDetails.similarElementsOnDOM = searchResult.details;
            elementDetails.searchStrategy = searchResult.strategy;
            elementDetails.searchXpath = searchResult.xpath;
            
            // Log found element details
            searchResult.details.forEach((detail: any, idx: number) => {
              console.log(`      [${idx + 1}] <${detail.tag}> ${detail.text}, id="${detail.id}", role="${detail.role}"`);
              console.log(`           Possible selectors: ${generateSelectorSuggestions(detail).slice(0, 3).join(' | ')}`);
            });
          } else {
            console.log(`\n   ⚠️  Could not find target element using any fallback strategy`);
            console.log(`   ℹ️  Attempt ID: ${actionId} - Element may have been removed or significantly changed`);
          }
          
          console.log(`   === END SMART SEARCH ===\n`);
        } catch (e) {
          console.log(`   ⚠️  Smart element search failed: ${(e as any).message}`);
        }
      }
    } catch (e) {
      console.log(`   ⚠️  Failed element extraction: ${(e as any).message}`);
    }

    console.log(`\n   🤖 Calling LLM with aria-snapshot + screenshot...`);

    // ✅ DEBUG: Log the exact payload being sent to LLM
    const llmPayload = {
      failedLocator: originalSelector,
      error: error?.message || 'not found',
      ariaSnapshot,
      screenshot: screenshot ? `[base64 image - ${screenshot.length} chars]` : 'none',
      failedElementSnapshot,
      contextHtml,
      elementCount,
      elementDetails
    };
    
    console.log(`\n   📤 === PAYLOAD SENT TO LLM ===`);
    console.log(`   Failed Locator: ${llmPayload.failedLocator}`);
    console.log(`   Error: ${llmPayload.error}`);
    console.log(`   Element Count: ${llmPayload.elementCount}`);
    console.log(`   Aria Snapshot Length: ${llmPayload.ariaSnapshot?.length || 0} chars`);
    console.log(`   Screenshot: ${llmPayload.screenshot}`);
    console.log(`\n   Element Details:`);
    console.log(JSON.stringify(llmPayload.elementDetails, null, 2));
    console.log(`   === END PAYLOAD ===\n`);

    const suggestions = await getLLMSuggestions({
      failedLocator: originalSelector,
      error: error?.message || 'not found',
      ariaSnapshot,
      screenshot,
      failedElementSnapshot,
      contextHtml,
      elementCount,
      elementDetails
    });

    console.log(`   🧠 LLM returned ${suggestions.length} suggestion(s)`);

    // ===== TWO-PASS VALIDATION STRATEGY =====
    // PASS 1: Strict mode - only accept if exactly 1 element found
    // PASS 2: Relaxed mode - accept first element if 1+ elements found (fallback for duplicates)
    
    console.log(`\n   🔐 PASS 1: Strict validation (require exactly 1 match)...`);
    for (let idx = 0; idx < suggestions.length; idx++) {
      const suggestion = suggestions[idx];
      console.log(`\n   📍 LLM Suggestion ${idx + 1}/${suggestions.length}:`);
      console.log(`      Locator: ${suggestion.locator}`);
      console.log(`      Confidence: ${(suggestion.confidence * 100).toFixed(0)}%`);
      console.log(`      Reasoning: ${suggestion.reasoning}`);

      try {
        const locator = resolveLocator(page, suggestion.locator);
        let count = 0;
        let countError = '';

        try {
          count = await locator.count();
        } catch (e) {
          countError = (e as any).message;
          console.log(`      ⚠️  Invalid locator syntax: ${countError.split('\n')[0]}`);
          console.log(`         Skipping...`);
          
          attempts.push({
            strategy: 'llm-strict',
            locator: suggestion.locator,
            reasoning: suggestion.reasoning,
            result: 'failed',
            count: 0,
            llmFailureReason: `Invalid syntax`,
            reason: `Invalid locator syntax`
          });
          
          continue;
        }

        console.log(`      Elements found: ${count}`);

        let duplicateElements: any[] = [];
        let llmFailureReason = '';
        let validation = { valid: false, elementCount: 0, duplicates: false };

        if (count === 0) {
          llmFailureReason = 'No elements found';
          console.log(`      ❌ ${llmFailureReason}`);
        } else if (count > 1) {
          const details = await locator.all();
          duplicateElements = await Promise.all(
            details.map((el: any) =>
              el.evaluate((elem: any) => ({
                text: elem.innerText?.slice(0, 50) || 'N/A',
                className: elem.className,
                id: elem.id || 'N/A',
                name: elem.getAttribute('name') || 'N/A',
                role: elem.getAttribute('role') || 'N/A',
                ariaLabel: elem.getAttribute('aria-label') || 'N/A'
              }))
            )
          );
          llmFailureReason = `Multiple matches (${count}) - skipping in STRICT mode`;
          console.log(`      ⚠️  ${llmFailureReason}`);
          duplicateElements.forEach((el, i) => {
            console.log(`         [${i + 1}] id="${el.id}" name="${el.name}" role="${el.role}"`);
          });
        } else {
          // count === 1, do full validation
          validation = await validateLocator(page, locator, ValidationMode.STRICT);
          console.log(`      Validation: ${validation.valid ? '✅ PASS' : '❌ FAIL'}`);
          if (!validation.valid) {
            llmFailureReason = 'Element not interactable';
          }
        }

        attempts.push({
          strategy: 'llm-strict',
          locator: suggestion.locator,
          reasoning: suggestion.reasoning,
          result: validation.valid ? 'success' : 'failed',
          count,
          duplicateElements: duplicateElements.length > 0 ? duplicateElements : null,
          llmFailureReason,
          reason: validation.valid ? 'Valid locator' : llmFailureReason
        });

        if (validation.valid) {
          console.log(`\n   ✅ [${actionId}] LLM SUCCESS (STRICT MODE) → ${suggestion.locator}`);

          saveToCache(originalSelector, suggestion.locator);

          logHealing({
            original: originalSelector,
            healed: suggestion.locator,
            strategy: 'llm',
            status: 'success',
            attempts,
            test: testName,
            action,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            elementDetails,
            scriptFailureReason,
            failedLocatorElements,
            allLlmSuggestions: suggestions
          });

          return await executeAction(locator, action, args);
        }
      } catch (e) {
        const errorMsg = (e as any).message;
        console.log(`      ❌ Error: ${errorMsg}`);
        attempts.push({
          strategy: 'llm-strict',
          locator: suggestion.locator,
          result: 'failed',
          llmFailureReason: `Error`,
          reason: `Error: ${errorMsg}`
        });
      }
    }

    // PASS 2: Relaxed mode - accept first element if duplicates exist
    console.log(`\n   ⚠️  PASS 1 failed. Trying PASS 2: Relaxed validation (accept first match)...`);
    for (let idx = 0; idx < suggestions.length; idx++) {
      const suggestion = suggestions[idx];
      console.log(`\n   📍 LLM Suggestion ${idx + 1}/${suggestions.length} (RELAXED):`);
      console.log(`      Locator: ${suggestion.locator}`);

      try {
        const locator = resolveLocator(page, suggestion.locator);
        let count = 0;

        try {
          count = await locator.count();
        } catch (e) {
          continue;
        }

        console.log(`      Elements found: ${count}`);

        let duplicateElements: any[] = [];
        let llmFailureReason = '';
        let validation = { valid: false, elementCount: 0, duplicates: false };

        if (count === 0) {
          llmFailureReason = 'No elements found';
          console.log(`      ❌ ${llmFailureReason}`);
        } else if (count > 1) {
          const details = await locator.all();
          duplicateElements = await Promise.all(
            details.map((el: any) =>
              el.evaluate((elem: any) => ({
                text: elem.innerText?.slice(0, 50) || 'N/A',
                className: elem.className,
                id: elem.id || 'N/A',
                name: elem.getAttribute('name') || 'N/A',
                role: elem.getAttribute('role') || 'N/A'
              }))
            )
          );
          console.log(`      ⚠️  Multiple matches (${count}) - using FIRST element (ambiguous!):`);
          duplicateElements.forEach((el, i) => {
            if (i === 0) console.log(`         ✓ [${i + 1}] id="${el.id}" name="${el.name}" (USING THIS)`);
            else console.log(`         [${i + 1}] id="${el.id}" name="${el.name}" (skipped)`);
          });
        }
        
        if (count > 0) {
          validation = await validateLocator(page, locator, ValidationMode.RELAXED);
          console.log(`      Validation: ${validation.valid ? '✅ PASS' : '❌ FAIL'}`);
          if (!validation.valid) {
            llmFailureReason = 'Element not interactable';
          }
        }

        attempts.push({
          strategy: 'llm-relaxed',
          locator: suggestion.locator,
          reasoning: suggestion.reasoning,
          result: validation.valid ? 'success' : 'failed',
          count,
          duplicateElements: duplicateElements.length > 0 ? duplicateElements : null,
          llmFailureReason,
          reason: validation.valid ? 'Valid locator' : llmFailureReason
        });

        if (validation.valid) {
          const modeNote = validation.duplicates ? ' (ambiguous - using first match)' : '';
          console.log(`\n   ✅ [${actionId}] LLM SUCCESS (RELAXED MODE${modeNote}) → ${suggestion.locator}`);
          if (validation.duplicates) {
            console.log(`   ⚠️  WARNING: Multiple matches found - using first element (may not be correct!)`);
          }

          saveToCache(originalSelector, suggestion.locator);

          logHealing({
            original: originalSelector,
            healed: suggestion.locator,
            strategy: 'llm',
            status: 'success',
            attempts,
            test: testName,
            action,
            confidence: suggestion.confidence,
            reasoning: suggestion.reasoning,
            elementDetails,
            scriptFailureReason,
            failedLocatorElements,
            allLlmSuggestions: suggestions
          });

          return await executeAction(locator, action, args);
        }
      } catch (e) {
        const errorMsg = (e as any).message;
        attempts.push({
          strategy: 'llm-relaxed',
          locator: suggestion.locator,
          result: 'failed',
          llmFailureReason: `Error`,
          reason: `Error: ${errorMsg}`
        });
      }
    }

    console.log(`\n   ❌ HEALING FAILED: Both PASS 1 (strict) and PASS 2 (relaxed) failed.`);

  } catch (e) {
    console.log(`   ❌ LLM SYSTEM ERROR: ${(e as any).message}`);
  }

  // ================= FINAL FAILURE =================
  
  // Collect all failure reasons
  let allFailureReasons = 'No valid locator found. Attempts:';
  attempts.forEach((attempt, idx) => {
    if (attempt.llmFailureReason) {
      allFailureReasons += `\n  ${idx + 1}. ${attempt.locator}: ${attempt.llmFailureReason}`;
    }
  });
  
  console.log(`\n🚨 [${actionId}] Healing FAILED completely - ${allFailureReasons.split('\n')[0]}`);

  logHealing({
    original: originalSelector,
    strategy: 'all',
    status: 'failed',
    attempts,
    final: allFailureReasons,
    test: testName,
    action,
    confidence: 0,
    scriptFailureReason,
    failedLocatorElements
  });

  throw error;
  } catch (healingException) {
    console.log(`\n❌ [${actionId}] === HEALING EXCEPTION ===`);
    console.log(`   Error: ${(healingException as any)?.message || healingException}`);
    console.log(`   Stack: ${(healingException as any)?.stack?.split('\n')[0]}`);
    throw error;  // Re-throw original error
  }
}

// ================= HELPERS =================

function extractTextFromSelector(selector: string): string | null {
  const match = selector.match(/login|submit|chat|checkout/i);
  return match ? match[0] : null;
}

async function executeAction(locator: any, action: string, args: any[]) {
  // Use SHORT timeout (1 second) for healing attempts to fail fast if locator is wrong
  // The element has already been validated as existing and visible (or interactable)
  // If it still fails here, it means the validation was incorrect or LLM suggestion is wrong
  if (action === 'click') return await locator.first().click({ timeout: 1000 });
  if (action === 'fill') return await locator.first().fill(args[0], { timeout: 1000 });
  if (action === 'waitFor') return await locator.first().waitFor(args[0]);
  if (action === 'scrollIntoViewIfNeeded') return await locator.first().scrollIntoViewIfNeeded(args[0]);
  throw new Error(`Unsupported action: ${action}`);
}
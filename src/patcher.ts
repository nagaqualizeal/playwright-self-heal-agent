import { Page, Locator, test } from '@playwright/test';
import { handleHealing, loadCache } from './healer';
import { resolveLocator } from './resolver';
import { validateLocator } from './validator';
import { logCacheHit } from './reporter';

let actionCounter = 0;
// Track all registered pages by their context
const pagesByContext = new Map<any, Page>();
// Keep track of the most recently patched page as fallback
let lastPatchedPage: Page | null = null;
let isLocatorProtoPatched = false;

// ================= CACHE CHECK HELPER =================
async function tryWithCache(
  locator: Locator,
  selector: string,
  action: string,
  args: any[],
  tryOriginal: () => Promise<any>,
  actionId: number,
  page: Page
): Promise<any> {
  // 🚀 CHECK CACHE FIRST - avoid 30s wait if we have a solution!
  const cache = loadCache();
  if (cache[selector]) {
    console.log(`⚡ [${actionId}] Cache hit for "${selector}" → using healed locator`);
    const cachedSelector = cache[selector];
    const cachedLocator = resolveLocator(page, cachedSelector);
    const isValid = await validateLocator(page, cachedLocator);
    
    if (isValid) {
      console.log(`✅ [${actionId}] Cached locator validated, using immediately`);
      // Track cache usage for reporting
      const testName = test.info().title;
      logCacheHit(selector, cachedSelector, actionId, testName);
      // Execute action with cached locator (no 30s wait!)
      if (action === 'click') return await cachedLocator.first().click({ timeout: 1000 });
      if (action === 'fill') return await cachedLocator.first().fill(args[0], { timeout: 1000 });
      if (action === 'waitFor') return await cachedLocator.first().waitFor(args[0]);
      if (action === 'scrollIntoViewIfNeeded') return await cachedLocator.first().scrollIntoViewIfNeeded(args[0]);
    } else {
      console.log(`⚠️ [${actionId}] Cached locator invalid, trying original`);
      // Cache is stale, clear it
      const cacheObj = loadCache();
      delete cacheObj[selector];
    }
  }
  
  // No cache or cache invalid → try original with 30s timeout
  return await tryOriginal();
}

// ================= HELPER FUNCTION FOR TEST NAME =================
function extractTestName(page: Page): string {
  // Try multiple ways to get test info from Playwright context
  const testInfo = (page as any)._testInfo || (page as any).__testInfo;
  
  // Method 1: Direct testInfo properties
  if (testInfo) {
    const title = testInfo.title || '';
    const file = testInfo.file || testInfo.fileName || '';
    const suite = testInfo.suite || '';
    
    if (title || file) {
      // Extract just the filename from full path
      const fileName = file ? file.split(/[/\\]/).pop() : '';
      const parts = [];
      if (fileName) parts.push(`[${fileName}]`);
      if (title) parts.push(title);
      if (suite && suite !== title) parts.push(`(${suite})`);
      return parts.length > 0 ? parts.join(' ') : 'unknown-test';
    }
  }
  
  // Method 2: Try to get from current test context
  try {
    const context = (page as any).context?.();
    const contextInfo = context?._testInfo || context?.testInfo;
    if (contextInfo?.title) {
      return contextInfo.title;
    }
  } catch (e) {
    // Continue to next method
  }
  
  // Fallback
  return 'unknown-test';
}

export function patchPage(page: Page) {

  const getTestName = () => extractTestName(page);

  // Store page reference by its context so we can find it later
  const context = page.context();
  pagesByContext.set(context, page);
  lastPatchedPage = page; // Keep track of most recent page for fallback

  // ================= PAGE LEVEL PATCH =================

  const originalClick = page.click.bind(page);
  const originalFill = page.fill.bind(page);

  page.click = async (selector: string, options?: any) => {
    const actionId = ++actionCounter;
    const testName = getTestName();

    try {
      // Let Playwright wait up to 30 seconds for element to appear
      return await originalClick(selector, { timeout: 30000 });

    } catch (error: any) {
      console.log(`⚠️ [${actionId}] Page.click failed after 30s timeout → healing triggered`);

      try {
        return await handleHealing(
          page,
          selector,
          'click',
          [],
          error,
          actionId,
          testName
        );
      } catch (healingError: any) {
        console.log(`❌ [${actionId}] Healing error: ${healingError?.message || healingError}`);
        throw error;
      }
    }
  };

  page.fill = async (selector: string, value: string, options?: any) => {
    const actionId = ++actionCounter;
    const testName = getTestName();

    try {
      // Let Playwright wait up to 30 seconds for element to appear
      return await originalFill(selector, value, { timeout: 30000 });

    } catch (error: any) {
      console.log(`⚠️ [${actionId}] Page.fill failed after 30s timeout → healing triggered`);

      try {
        return await handleHealing(
          page,
          selector,
          'fill',
          [value],
          error,
          actionId,
          testName
        );
      } catch (healingError: any) {
        console.log(`❌ [${actionId}] Healing error: ${healingError?.message || healingError}`);
        throw error;
      }
    }
  };

  (page as any).waitForElementVisible = async (selector: string, options?: any) => {
    const actionId = ++actionCounter;
    const testName = getTestName();

    try {
      // Use Playwright's built-in wait with timeout
      const locator = page.locator(selector);
      return await locator.waitFor({ state: 'visible', timeout: 30000, ...options });

    } catch (error: any) {
      console.log(`⚠️ [${actionId}] Page.waitForElementVisible failed after 30s timeout → healing triggered`);

      try {
        return await handleHealing(
          page,
          selector,
          'waitFor',
          [{ state: 'visible', ...options }],
          error,
          actionId,
          testName
        );
      } catch (healingError: any) {
        console.log(`❌ [${actionId}] Healing error: ${healingError?.message || healingError}`);
        throw error;
      }
    }
  };

  // ================= LOCATOR LEVEL PATCH (Global, but smart about page detection) =================

  // Only patch once - all pages will use the same patched prototype
  if (!isLocatorProtoPatched) {
    const locatorProto = Object.getPrototypeOf(page.locator('body'));

    const originalLocatorFill = locatorProto.fill;
    const originalLocatorClick = locatorProto.click;
    const originalLocatorWaitFor = locatorProto.waitFor;
    const originalLocatorScrollIntoViewIfNeeded = locatorProto.scrollIntoViewIfNeeded;

    // Helper: Find the page for a locator by checking its context and internal properties
    const getPageForLocator = (locator: Locator): Page | null => {
      // Try to access page from locator's internal _page property
      const locatorInternal = (locator as any);
      if (locatorInternal._page) {
        // Found page directly in locator
        return locatorInternal._page;
      }
      
      // Try to access context from locator and find matching page
      if (locatorInternal._context) {
        const storedPage = pagesByContext.get(locatorInternal._context);
        if (storedPage) return storedPage;
      }
      
      // Fallback: check all registered pages
      for (const [context, registeredPage] of pagesByContext.entries()) {
        if (registeredPage && registeredPage.isClosed && !registeredPage.isClosed()) {
          return registeredPage;
        }
      }
      
      // Last resort: use the most recently patched page
      if (lastPatchedPage && !lastPatchedPage.isClosed()) {
        return lastPatchedPage;
      }
      
      return null;
    };

    locatorProto.fill = async function (value: string, options?: any) {
      const actionId = ++actionCounter;
      
      // Get the page from this locator at runtime
      let pageForHealing = getPageForLocator(this as any);
      if (!pageForHealing) {
        console.warn(`[${actionId}] ⚠️ WARNING: Could not determine page for locator`);
        return await originalLocatorFill.call(this, value, { timeout: 30000 });
      }

      const testName = extractTestName(pageForHealing);
      const selector = (this as any)._selector || 'unknown-locator';

      try {
        // 🚀 TRY WITH CACHE FIRST!
        return await tryWithCache(
          this as any,
          selector,
          'fill',
          [value],
          () => originalLocatorFill.call(this, value, { timeout: 30000 }),
          actionId,
          pageForHealing
        );

      } catch (error: any) {
        console.log(`⚠️ [${actionId}] Locator.fill failed after 30s timeout → healing triggered`);

        try {
          return await handleHealing(
            pageForHealing,
            selector,
            'fill',
            [value],
            error,
            actionId,
            testName
          );
        } catch (healingError: any) {
          console.log(`❌ [${actionId}] Healing error: ${healingError?.message || healingError}`);
          throw error;
        }
      }
    };

    locatorProto.click = async function (options?: any) {
      const actionId = ++actionCounter;
      
      // Get the page from this locator at runtime
      let pageForHealing = getPageForLocator(this as any);
      if (!pageForHealing) {
        console.warn(`[${actionId}] ⚠️ WARNING: Could not determine page for locator`);
        return await originalLocatorClick.call(this, { timeout: 30000 });
      }

      const testName = extractTestName(pageForHealing);
      const selector = (this as any)._selector || 'unknown-locator';

      try {
        // 🚀 TRY WITH CACHE FIRST!
        return await tryWithCache(
          this as any,
          selector,
          'click',
          [],
          () => originalLocatorClick.call(this, { timeout: 30000 }),
          actionId,
          pageForHealing
        );

      } catch (error: any) {
        console.log(`⚠️ [${actionId}] Locator.click failed after 30s timeout → healing triggered`);

        try {
          return await handleHealing(
            pageForHealing,
            selector,
            'click',
            [],
            error,
            actionId,
            testName
          );
        } catch (healingError: any) {
          console.log(`❌ [${actionId}] Healing error: ${healingError?.message || healingError}`);
          throw error;
        }
      }
    };

    locatorProto.waitFor = async function (options?: any) {
      const actionId = ++actionCounter;
      
      // Get the page from this locator at runtime
      let pageForHealing = getPageForLocator(this as any);
      if (!pageForHealing) {
        console.warn(`[${actionId}] ⚠️ WARNING: Could not determine page for locator`);
        return await originalLocatorWaitFor.call(this, options);
      }

      const testName = extractTestName(pageForHealing);
      const selector = (this as any)._selector || 'unknown-locator';

      try {
        // 🚀 TRY WITH CACHE FIRST!
        return await tryWithCache(
          this as any,
          selector,
          'waitFor',
          [options],
          () => originalLocatorWaitFor.call(this, options),
          actionId,
          pageForHealing
        );

      } catch (error: any) {
        console.log(`⚠️ [${actionId}] Locator.waitFor failed → healing triggered`);

        try {
          return await handleHealing(
            pageForHealing,
            selector,
            'waitFor',
            [options],
            error,
            actionId,
            testName
          );
        } catch (healingError: any) {
          console.log(`❌ [${actionId}] Healing error: ${healingError?.message || healingError}`);
          throw error;
        }
      }
    };

    locatorProto.scrollIntoViewIfNeeded = async function (options?: any) {
      const actionId = ++actionCounter;
      
      // Get the page from this locator at runtime
      let pageForHealing = getPageForLocator(this as any);
      if (!pageForHealing) {
        console.warn(`[${actionId}] ⚠️ WARNING: Could not determine page for locator`);
        return await originalLocatorScrollIntoViewIfNeeded.call(this, options);
      }

      const testName = extractTestName(pageForHealing);
      const selector = (this as any)._selector || 'unknown-locator';

      try {
        // 🚀 TRY WITH CACHE FIRST!
        return await tryWithCache(
          this as any,
          selector,
          'scrollIntoViewIfNeeded',
          [options],
          () => originalLocatorScrollIntoViewIfNeeded.call(this, options),
          actionId,
          pageForHealing
        );

      } catch (error: any) {
        console.log(`⚠️ [${actionId}] Locator.scrollIntoViewIfNeeded failed → healing triggered`);

        try {
          return await handleHealing(
            pageForHealing,
            selector,
            'scrollIntoViewIfNeeded',
            [options],
            error,
            actionId,
            testName
          );
        } catch (healingError: any) {
          console.log(`❌ [${actionId}] Healing error: ${healingError?.message || healingError}`);
          throw error;
        }
      }
    };

    isLocatorProtoPatched = true;
  }
}
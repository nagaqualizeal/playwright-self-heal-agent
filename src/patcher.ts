import { Page } from '@playwright/test';
import { handleHealing } from './healer';

let actionCounter = 0;

export function patchPage(page: Page) {

  const getTestName = () => {
  const info = (page as any).__testInfo;
return info
  ? `${info.suite} → ${info.title}`
  : 'unknown-test';
};

  // ================= PAGE LEVEL PATCH =================

  const originalClick = page.click.bind(page);
  const originalFill = page.fill.bind(page);

  page.click = async (selector: string, options?: any) => {
    const actionId = ++actionCounter;
    const testName = getTestName();

    

    try {
      const count = await page.locator(selector).count();

      if (count === 0) {
        console.log(`⚠️ [${actionId}] Element not found immediately → healing triggered`);

        return await handleHealing(
          page,
          selector,
          'click',
          [],
          null,
          actionId,
          testName
        );
      }

      return await originalClick(selector, { timeout: 2000 });

    } catch (error: any) {
      console.log(`⚠️ [${actionId}] Page.click failed → healing triggered`);

      return await handleHealing(
        page,
        selector,
        'click',
        [],
        error,
        actionId,
        testName
      );
    }
  };

  page.fill = async (selector: string, value: string, options?: any) => {
    const actionId = ++actionCounter;
    const testName = getTestName();

  

    try {
      const count = await page.locator(selector).count();

      if (count === 0) {
        console.log(`⚠️ [${actionId}] Element not found immediately → healing triggered`);

        return await handleHealing(
          page,
          selector,
          'fill',
          [value],
          null,
          actionId,
          testName
        );
      }

      return await originalFill(selector, value, { timeout: 2000 });

    } catch (error: any) {
      console.log(`⚠️ [${actionId}] Page.fill failed → healing triggered`);

      return await handleHealing(
        page,
        selector,
        'fill',
        [value],
        error,
        actionId,
        testName
      );
    }
  };

  // ================= LOCATOR LEVEL PATCH =================

  const locatorProto = Object.getPrototypeOf(page.locator('body'));

  const originalLocatorFill = locatorProto.fill;
  const originalLocatorClick = locatorProto.click;

  locatorProto.fill = async function (value: string, options?: any) {
    const actionId = ++actionCounter;
    const testName = getTestName();

    const selector = (this as any)._selector || 'unknown-locator';

    try {
      // 🔥 EARLY CHECK (IMPORTANT FIX)
      const count = await this.count();

      if (count === 0) {
        console.log(`⚠️ [${actionId}] Element not found immediately → healing triggered`);

        return await handleHealing(
          page,
          selector,
          'fill',
          [value],
          null,
          actionId,
          testName
        );
      }

      return await originalLocatorFill.call(this, value, { timeout: 2000 });

    } catch (error: any) {
      console.log(`⚠️ [${actionId}] Locator.fill failed → healing triggered`);

      return await handleHealing(
        page,
        selector,
        'fill',
        [value],
        error,
        actionId,
        testName
      );
    }
  };

  locatorProto.click = async function (options?: any) {
    const actionId = ++actionCounter;
    const testName = getTestName();

    const selector = (this as any)._selector || 'unknown-locator';

    

    try {
      // 🔥 EARLY CHECK (IMPORTANT FIX)
      const count = await this.count();

      if (count === 0) {
        console.log(`⚠️ [${actionId}] Element not found immediately → healing triggered`);

        return await handleHealing(
          page,
          selector,
          'click',
          [],
          null,
          actionId,
          testName
        );
      }

      return await originalLocatorClick.call(this, { timeout: 2000 });

    } catch (error: any) {
      console.log(`⚠️ [${actionId}] Locator.click failed → healing triggered`);

      return await handleHealing(
        page,
        selector,
        'click',
        [],
        error,
        actionId,
        testName
      );
    }
  };
}
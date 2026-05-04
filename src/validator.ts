import { Page, Locator } from '@playwright/test';

export async function validateLocator(page: Page, locator: Locator) {
  try {
    const count = await locator.count();

    if (count === 1) {
      await locator.first().waitFor({ state: 'visible', timeout: 2000 });
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
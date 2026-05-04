import { test as base } from '@playwright/test';
import { patchPage } from './patcher';

export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    (page as any).__testInfo = {
      title: testInfo.title,
      suite: testInfo.titlePath?.[0] || 'unknown-suite'
    };

    patchPage(page);
    await use(page);
  },
});
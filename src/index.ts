import { test as base } from '@playwright/test';
import { wrapPage, bindContext, bind } from './core/binding';
import { ensureFreshRunState } from './core/report';
import { loadConfig } from './core/config';

// HEALER_ENABLED=false hands tests the plain Playwright page/context: no proxy, no rule-based pass,
// no cache, and the previous run's report is left untouched — the same as importing `test` from
// @playwright/test directly.
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    if (!loadConfig().enabled) return use(context);
    (context as any).__qashTestName = `[${testInfo.file.split(/[/\\]/).pop()}] ${testInfo.title}`;
    await use(bindContext(context));
  },
  page: async ({ page, context }, use, testInfo) => {
    if (!loadConfig().enabled) return use(page);
    await ensureFreshRunState();
    (page as any).__qashTestName = (context as any).__qashTestName || `[${testInfo.file.split(/[/\\]/).pop()}] ${testInfo.title}`;
    await use(wrapPage(page));
  },
});

export { expect } from '@playwright/test';
export { bind, bindContext };

import { test as base } from '@playwright/test';
import { wrapPage, bindContext, bind } from './core/binding';
import { ensureReportResetForThisRun } from './core/report';

export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    (context as any).__qashTestName = `[${testInfo.file.split(/[/\\]/).pop()}] ${testInfo.title}`;
    await use(bindContext(context));
  },
  page: async ({ page, context }, use, testInfo) => {
    ensureReportResetForThisRun();
    (page as any).__qashTestName = (context as any).__qashTestName || `[${testInfo.file.split(/[/\\]/).pop()}] ${testInfo.title}`;
    await use(wrapPage(page));
  },
});

export { expect } from '@playwright/test';
export { bind, bindContext };

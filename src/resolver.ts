import { Page } from '@playwright/test';

export function resolveLocator(page: Page, locatorStr: string) {

  if (locatorStr.includes('getByRole')) {
    const nameMatch = locatorStr.match(/name:\s*['"](.*?)['"]/);

    return page.getByRole('button', {
      name: nameMatch ? nameMatch[1] : ''
    });
  }

  if (locatorStr.includes('getByText')) {
    const textMatch = locatorStr.match(/['"](.*?)['"]/);

    return page.getByText(textMatch ? textMatch[1] : '');
  }

  if (locatorStr.startsWith('//')) {
    return page.locator(`xpath=${locatorStr}`);
  }

  return page.locator(locatorStr);
}
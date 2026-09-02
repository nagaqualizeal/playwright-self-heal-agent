import { Page, FrameLocator } from '@playwright/test';

type Locatable = Page | FrameLocator;

export type LocatorIntent = {
  attributeName?: string;
  attributeValue?: string;
  textContent?: string;
};

// Parses a broken selector's own text to recover what it was trying to match, so
// a zero-match failure with no `.describe()` still gives the healer something
// concrete to search for instead of nothing at all.
export function extractLocatorIntent(selector: string): LocatorIntent {
  const attrMatch = selector.match(/@([\w-]+)=['"]([^'"]+)['"]/) || selector.match(/\[([\w-]+)=['"]([^'"]+)['"]\]/);
  if (attrMatch) {
    return { attributeName: attrMatch[1], attributeValue: attrMatch[2] };
  }

  const textMatch =
    selector.match(/text\s*\(\s*\)\s*=\s*['"]([^'"]+)['"]/) ||
    selector.match(/contains\s*\(\s*text\s*\(\s*\)\s*,\s*['"]([^'"]+)['"]\s*\)/) ||
    selector.match(/getByText\(\s*['"]([^'"]+)['"]/);
  if (textMatch) {
    return { textContent: textMatch[1] };
  }

  return {};
}

export type ElementDetails = {
  tag: string;
  text: string;
  id: string | null;
  className: string | null;
  role: string | null;
  name: string | null;
  dataTestId: string | null;
  ariaLabel: string | null;
};

async function describeElements(elements: any[]): Promise<ElementDetails[]> {
  if (elements.length === 0) return [];
  return Promise.all(
    elements.map((el) =>
      el.evaluate((elem: any) => ({
        tag: elem.tagName.toLowerCase(),
        text: (elem.innerText || elem.textContent || '').slice(0, 100),
        id: elem.id || null,
        className: elem.className || null,
        role: elem.getAttribute('role') || null,
        name: elem.getAttribute('name') || null,
        dataTestId: elem.getAttribute('data-testid') || null,
        ariaLabel: elem.getAttribute('aria-label') || null,
      }))
    )
  );
}

export type ElementSearchResult = {
  strategy: string;
  xpath: string;
  details: ElementDetails[];
  note?: string;
};

// Zero-cost (no AI) fallback search used when the original locator matches
// nothing at all in the current DOM: tries the same attribute under a handful
// of common alternative names, then falls back to a text-content search.
export async function findSimilarElements(target: Locatable, intent: LocatorIntent): Promise<ElementSearchResult | null> {
  if (intent.attributeName && intent.attributeValue) {
    const exactXpath = `//*[@${intent.attributeName}="${intent.attributeValue}"]`;
    const exact = await target.locator(exactXpath).all().catch(() => []);
    if (exact.length > 0) {
      return { strategy: 'exact-attribute', xpath: exactXpath, details: await describeElements(exact) };
    }

    const fallbackAttributes = ['data-testid', 'data-test', 'name', 'id', 'aria-label', 'placeholder'];
    for (const attr of fallbackAttributes) {
      if (attr === intent.attributeName) continue;

      const xpath = `//*[@${attr}="${intent.attributeValue}"]`;
      const elements = await target.locator(xpath).all().catch(() => []);
      if (elements.length > 0) {
        return {
          strategy: 'fallback-attribute',
          xpath,
          details: await describeElements(elements),
          note: `Attribute changed from @${intent.attributeName} to @${attr}`,
        };
      }

      const partialXpath = `//*[contains(@${attr}, "${intent.attributeValue}")]`;
      const partial = await target.locator(partialXpath).all().catch(() => []);
      if (partial.length > 0) {
        return {
          strategy: 'fallback-attribute-partial',
          xpath: partialXpath,
          details: await describeElements(partial),
          note: `Attribute changed to @${attr} (partial value match)`,
        };
      }
    }
  }

  if (intent.textContent) {
    const xpath = `//*[contains(text(), "${intent.textContent}")]`;
    const elements = await target.locator(xpath).all().catch(() => []);
    if (elements.length > 0) {
      return { strategy: 'text-content', xpath, details: await describeElements(elements) };
    }
  }

  return null;
}

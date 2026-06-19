import { Page, Locator } from '@playwright/test';

/**
 * Parse locator to extract search intent
 * Handles: //button[@title='XX'], //span[@data-testid='XX'], //input[@name='XX'], etc.
 */
export function extractLocatorIntent(selector: string): {
  attributeName?: string;
  attributeValue?: string;
  textContent?: string;
  elementType?: string;
} {
  // Try to extract attribute-based selectors (XPath)
  // Pattern: @attributeName='value' or @attributeName="value"
  const attrMatch = selector.match(/@([\w-]+)=['"]([^'"]+)['"]/);
  if (attrMatch) {
    return {
      attributeName: attrMatch[1],      // 'title', 'data-testid', 'name', etc.
      attributeValue: attrMatch[2],     // 'AT401010126', 'ASTM', etc.
    };
  }

  // Try to extract text-based selectors
  // Pattern: text()='value' or contains(text(), 'value')
  const textMatch = selector.match(/text\s*\(\s*\)\s*=\s*['"]([^'"]+)['"]/);
  if (textMatch) {
    return {
      textContent: textMatch[1],
    };
  }

  const containsMatch = selector.match(/contains\s*\(\s*text\s*\(\s*\)\s*,\s*['"]([^'"]+)['"]\s*\)/);
  if (containsMatch) {
    return {
      textContent: containsMatch[1],
    };
  }

  // Try to extract CSS attribute selectors
  // Pattern: [attributeName='value']
  const cssAttrMatch = selector.match(/\[([\w-]+)=['"]([^'"]+)['"]\]/);
  if (cssAttrMatch) {
    return {
      attributeName: cssAttrMatch[1],
      attributeValue: cssAttrMatch[2],
    };
  }

  return {};
}

/**
 * Find target element using multiple fallback strategies
 * This is the key to handling element changes!
 */
export async function findTargetElement(
  page: Page,
  originalSelector: string,
  intent: ReturnType<typeof extractLocatorIntent>
) {
  const strategies = [];

  // Strategy 1: Exact attribute match (any tag)
  if (intent.attributeName && intent.attributeValue) {
    console.log(`\n   🔍 Strategy 1: Exact attribute match`);
    console.log(`      Looking for: //*[@${intent.attributeName}="${intent.attributeValue}"]`);

    try {
      const xpath = `//*[@${intent.attributeName}="${intent.attributeValue}"]`;
      const elements = await page.locator(xpath).all();

      if (elements.length > 0) {
        console.log(`      ✅ FOUND ${elements.length} element(s) with exact match`);
        return {
          strategy: 'exact-attribute',
          xpath,
          elements,
          details: await extractElementDetails(elements),
        };
      } else {
        console.log(`      ❌ No exact match found`);
      }
    } catch (e) {
      console.log(`      ⚠️  Error: ${(e as any).message}`);
    }

    // Strategy 2: Partial attribute match (contains)
    console.log(`\n   🔍 Strategy 2: Partial attribute match (contains)`);
    console.log(`      Looking for: //*[contains(@${intent.attributeName}, "${intent.attributeValue}")]`);

    try {
      const xpath = `//*[contains(@${intent.attributeName}, "${intent.attributeValue}")]`;
      const elements = await page.locator(xpath).all();

      if (elements.length > 0) {
        console.log(`      ✅ FOUND ${elements.length} element(s) with partial match`);
        return {
          strategy: 'partial-attribute',
          xpath,
          elements,
          details: await extractElementDetails(elements),
          note: 'Value changed (contains match)',
        };
      } else {
        console.log(`      ❌ No partial match found`);
      }
    } catch (e) {
      console.log(`      ⚠️  Error: ${(e as any).message}`);
    }

    // Strategy 3: Try fallback attributes with same value
    const fallbackAttributes = ['data-testid', 'data-test', 'name', 'id', 'aria-label', 'title'];
    const originalAttr = intent.attributeName;
    const valuesToTry = [intent.attributeValue];

    console.log(`\n   🔍 Strategy 3: Fallback attributes`);
    for (const attr of fallbackAttributes) {
      if (attr === originalAttr) continue; // Skip original

      console.log(`      Trying @${attr}="${intent.attributeValue}"...`);

      try {
        // Exact match
        const xpath = `//*[@${attr}="${intent.attributeValue}"]`;
        const elements = await page.locator(xpath).all();

        if (elements.length > 0) {
          console.log(`      ✅ FOUND with @${attr}`);
          return {
            strategy: 'fallback-attribute',
            xpath,
            elements,
            details: await extractElementDetails(elements),
            note: `Attribute changed from @${originalAttr} to @${attr}`,
          };
        }

        // Partial match
        const partialXpath = `//*[contains(@${attr}, "${intent.attributeValue}")]`;
        const partialElements = await page.locator(partialXpath).all();

        if (partialElements.length > 0) {
          console.log(`      ✅ FOUND with @${attr} (partial)`);
          return {
            strategy: 'fallback-attribute-partial',
            xpath: partialXpath,
            elements: partialElements,
            details: await extractElementDetails(partialElements),
            note: `Attribute changed to @${attr} and value changed (partial match)`,
          };
        }
      } catch (e) {
        // Continue to next attribute
      }
    }
  }

  // Strategy 4: Search by text content
  if (intent.textContent) {
    console.log(`\n   🔍 Strategy 4: Search by text content`);
    console.log(`      Looking for elements containing: "${intent.textContent}"`);

    try {
      const xpath = `//*[contains(text(), "${intent.textContent}")]`;
      const elements = await page.locator(xpath).all();

      if (elements.length > 0) {
        console.log(`      ✅ FOUND ${elements.length} element(s)`);
        return {
          strategy: 'text-content',
          xpath,
          elements,
          details: await extractElementDetails(elements),
        };
      }
    } catch (e) {
      console.log(`      ⚠️  Error: ${(e as any).message}`);
    }
  }

  // Strategy 5: Search aria-snapshot for similar values
  if (intent.attributeValue) {
    console.log(`\n   🔍 Strategy 5: Search aria-snapshot for similar values`);
    console.log(`      Looking for values similar to: "${intent.attributeValue}"`);

    try {
      const snapshot = await page.locator('body').ariaSnapshot();

      // Find similar text (starts with, contains pattern)
      const similarPattern = new RegExp(`${intent.attributeValue}\\w*`, 'gi');
      const matches = snapshot.match(similarPattern);

      if (matches && matches.length > 0) {
        const uniqueMatches = [...new Set(matches)];
        console.log(`      Found similar values: ${uniqueMatches.join(', ')}`);

        // Try to find elements with these values
        for (const match of uniqueMatches) {
          if (match === intent.attributeValue) continue; // Skip exact (already tried)

          console.log(`      Trying similar value: "${match}"`);

          try {
            // Try with original attribute first
            let xpath = `//*[@${intent.attributeName}="${match}"]`;
            let elements = await page.locator(xpath).all();

            if (elements.length > 0) {
              console.log(`      ✅ FOUND element with similar value`);
              return {
                strategy: 'similar-value',
                xpath,
                elements,
                details: await extractElementDetails(elements),
                note: `Value changed from "${intent.attributeValue}" to "${match}"`,
              };
            }

            // Try partial
            xpath = `//*[contains(@${intent.attributeName}, "${match}")]`;
            elements = await page.locator(xpath).all();

            if (elements.length > 0) {
              console.log(`      ✅ FOUND element with similar value (partial)`);
              return {
                strategy: 'similar-value-partial',
                xpath,
                elements,
                details: await extractElementDetails(elements),
                note: `Value changed to similar: "${match}"`,
              };
            }
          } catch (e) {
            // Continue
          }
        }
      }
    } catch (e) {
      console.log(`      ⚠️  Aria-snapshot search failed: ${(e as any).message}`);
    }
  }

  console.log(`\n   ❌ All strategies failed - element not found`);
  return null;
}

/**
 * Extract detailed information from elements
 * Send this to LLM so it knows exactly what we found
 */
export async function extractElementDetails(elements: Locator[]) {
  if (elements.length === 0) return [];

  return await Promise.all(
    elements.map((el, idx) =>
      el.evaluate((elem: any, index: number) => {
        // Get all relevant attributes
        const attributes = new Map<string, string>();
        for (const attr of elem.attributes || []) {
          attributes.set(attr.name, attr.value);
        }

        return {
          index: index,
          tag: elem.tagName.toLowerCase(),
          text: (elem.innerText || elem.textContent || '').slice(0, 100),
          html: elem.outerHTML.slice(0, 200),
          // All attributes that might be useful
          id: elem.id || null,
          className: elem.className || null,
          role: elem.getAttribute('role') || null,
          title: elem.getAttribute('title') || null,
          name: elem.getAttribute('name') || null,
          type: elem.getAttribute('type') || null,
          dataTestId: elem.getAttribute('data-testid') || null,
          dataTest: elem.getAttribute('data-test') || null,
          dataId: elem.getAttribute('data-id') || null,
          ariaLabel: elem.getAttribute('aria-label') || null,
          ariaLabelledBy: elem.getAttribute('aria-labelledby') || null,
          // All attributes for LLM
          allAttributes: Object.fromEntries(attributes),
          // Possible selectors
          possibleSelectors: {
            id: elem.id ? `#${elem.id}` : null,
            dataTestId: elem.getAttribute('data-testid') ? `[data-testid="${elem.getAttribute('data-testid')}"]` : null,
            role: elem.getAttribute('role') ? `[role="${elem.getAttribute('role')}"]` : null,
            byRole: elem.getAttribute('role') && (elem.innerText || elem.getAttribute('aria-label')) 
              ? `getByRole('${elem.getAttribute('role')}', { name: '${elem.innerText || elem.getAttribute('aria-label')}' })`
              : null,
          },
        };
      }, idx)
    )
  );
}

/**
 * Generate locator suggestions based on found element
 * This helps LLM understand what selectors would work
 */
export function generateSelectorSuggestions(elementDetails: any) {
  const suggestions: string[] = [];

  if (elementDetails.id) {
    suggestions.push(`#${elementDetails.id}`);
    suggestions.push(`page.locator('#${elementDetails.id}')`);
  }

  if (elementDetails.dataTestId) {
    suggestions.push(`[data-testid="${elementDetails.dataTestId}"]`);
    suggestions.push(`page.getByTestId('${elementDetails.dataTestId}')`);
  }

  if (elementDetails.role && elementDetails.text) {
    suggestions.push(`page.getByRole('${elementDetails.role}', { name: '${elementDetails.text}' })`);
  }

  if (elementDetails.text) {
    suggestions.push(`page.getByText('${elementDetails.text}')`);
    suggestions.push(`page.locator(\`//*[contains(text(), '${elementDetails.text}')]\`)`);
  }

  if (elementDetails.ariaLabel) {
    suggestions.push(`page.getByLabel('${elementDetails.ariaLabel}')`);
  }

  if (elementDetails.title) {
    suggestions.push(`[title="${elementDetails.title}"]`);
  }

  // CSS selector by tag + attributes
  const classSelector = elementDetails.className ? `.${elementDetails.className.split(' ')[0]}` : '';
  if (classSelector) {
    suggestions.push(`${elementDetails.tag}${classSelector}`);
  }

  return [...new Set(suggestions)]; // Remove duplicates
}

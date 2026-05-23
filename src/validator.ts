import { Page, Locator } from '@playwright/test';

export enum ValidationMode {
  STRICT = 'STRICT',    // Only accept if exactly 1 element found
  RELAXED = 'RELAXED'   // Accept 1+ elements, use first
}

export async function validateLocator(
  page: Page,
  locator: Locator,
  mode: ValidationMode = ValidationMode.STRICT
): Promise<{ valid: boolean; elementCount: number; duplicates: boolean }> {
  try {
    // Wait for page to be stable (helps with async loading)
    await page.waitForLoadState('networkidle').catch(() => {});
    
    // Check if element is attached to DOM (includes hidden elements!)
    // Use evaluate to count elements directly in DOM, not just visible ones
    const elementCount = await locator.evaluate((elements: any) => {
      // If single element, wrap in array
      if (!Array.isArray(elements)) {
        return elements ? 1 : 0;
      }
      return elements.length;
    }).catch(() => {
      // Fallback: try count() for visible elements
      return locator.count().catch(() => 0);
    });
    
    const hasDuplicates = elementCount > 1;
    
    // STRICT MODE: Only accept if exactly 1 element
    if (mode === ValidationMode.STRICT) {
      if (elementCount === 1) {
        const targetElement = locator;
        
        // Wait for element to be visible with longer timeout
        try {
          await targetElement.waitFor({ state: 'visible', timeout: 5000 });
          return { valid: true, elementCount, duplicates: false };
        } catch (visibilityError) {
          // Element may be hidden, but still functional - check if it's enabled
          try {
            const isDisabled = await targetElement.evaluate((el: any) => {
              return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
            }).catch(() => false);
            
            if (!isDisabled) {
              return { valid: true, elementCount, duplicates: false };
            }
          } catch (e) {
            return { valid: true, elementCount, duplicates: false };
          }
        }
      }
      
      // Reject: either 0 elements or duplicates
      return { valid: false, elementCount, duplicates: hasDuplicates };
    }
    
    // RELAXED MODE: Accept 1+ elements, use first
    if (mode === ValidationMode.RELAXED) {
      if (elementCount >= 1) {
        const targetElement = elementCount > 1 ? locator.first() : locator;
        
        try {
          await targetElement.waitFor({ state: 'visible', timeout: 5000 });
          return { valid: true, elementCount, duplicates: hasDuplicates };
        } catch (visibilityError) {
          try {
            const isDisabled = await targetElement.evaluate((el: any) => {
              return el.disabled === true || el.getAttribute('aria-disabled') === 'true';
            }).catch(() => false);
            
            if (!isDisabled) {
              return { valid: true, elementCount, duplicates: hasDuplicates };
            }
          } catch (e) {
            return { valid: true, elementCount, duplicates: hasDuplicates };
          }
        }
      }
      return { valid: false, elementCount, duplicates: hasDuplicates };
    }

    return { valid: false, elementCount, duplicates: hasDuplicates };
  } catch (error) {
    const err = error as any;
    console.log(`   ℹ️  Validator detailed error: ${err.message || 'Unknown error'}`);
    return { valid: false, elementCount: 0, duplicates: false };
  }
}
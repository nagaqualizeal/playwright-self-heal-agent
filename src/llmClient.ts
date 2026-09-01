import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import fs from 'fs';

// Load config
const config = JSON.parse(
  fs.readFileSync('.selfhealrc.json', 'utf-8')
);

export async function getLLMSuggestions(payload: any) {
  const provider = config.llmProvider;

  if (provider === 'openai') {
    return await callOpenAI(payload);
  }

  if (provider === 'claude') {
    return await callClaude(payload);
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

// ==================== OPENAI ====================

async function callOpenAI(payload: any) {
  try {
    console.log('🤖 Using OpenAI');

    const prompt = buildPrompt(payload);
    
    console.log(`\n   📨 === SENDING PROMPT TO OPENAI ===`);
    console.log(`   Prompt length: ${prompt.length} chars`);
    console.log(`   Prompt preview (first 800 chars):`);
    console.log(prompt.substring(0, 800));
    console.log(`   === END PROMPT PREVIEW ===\n`);

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.openai.model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 1500,
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const text = response.data.choices[0].message.content;

    console.log(`\n   📥 === OPENAI RESPONSE ===`);
    console.log(`   Raw response (first 1000 chars):`);
    console.log(text.substring(0, 1000));
    console.log(`   === END RESPONSE ===\n`);

   const cleaned = extractJSON(text);

   return JSON.parse(cleaned);

  } catch (e: any) {
    console.log('❌ OpenAI error:', e.response?.data || e.message);
    return [];
  }
}

// ==================== CLAUDE ====================

async function callClaude(payload: any) {
  try {
    console.log('🤖 Using Claude');

    const prompt = buildPrompt(payload);
    
    console.log(`\n   📨 === SENDING PROMPT TO CLAUDE ===`);
    console.log(`   Prompt length: ${prompt.length} chars`);
    console.log(`   Prompt preview (first 800 chars):`);
    console.log(prompt.substring(0, 800));
    console.log(`   === END PROMPT PREVIEW ===\n`);

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: config.claude.model,
        max_tokens: 1500,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      },
      {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const text = response.data.content[0].text;

    console.log(`\n   📥 === CLAUDE RESPONSE ===`);
    console.log(`   Raw response (first 1000 chars):`);
    console.log(text.substring(0, 1000));
    console.log(`   === END RESPONSE ===\n`);

   const cleaned = extractJSON(text);

return JSON.parse(cleaned);

  } catch (e: any) {
    console.log('❌ Claude error:', e.response?.data || e.message);
    return [];
  }
}

function extractJSON(text: string): string {
  // Remove ```json ... ``` wrapper
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);

  if (match) {
    return match[1];
  }

  // fallback: try raw JSON
  return text.trim();
}
// ==================== COMMON PROMPT ====================
function buildPrompt(payload: any) {
  const ariaSnapshotStr = typeof payload.ariaSnapshot === 'string' 
    ? payload.ariaSnapshot 
    : JSON.stringify(payload.ariaSnapshot, null, 2);
  
  const failedElementSnapshotStr = typeof payload.failedElementSnapshot === 'string'
    ? payload.failedElementSnapshot
    : JSON.stringify(payload.failedElementSnapshot, null, 2);

  // ✅ DEBUG: Log what we're about to send
  console.log(`\n   📝 === BUILDING LLM PROMPT ===`);
  console.log(`   Failed Locator: ${payload.failedLocator}`);
  console.log(`   Error Reason: ${payload.error}`);
  console.log(`   Element Count: ${payload.elementCount}`);
  console.log(`   Similar Elements on DOM: ${payload.elementDetails?.similarElementsOnDOM?.length || 0} found`);
  if (payload.elementDetails?.similarElementsOnDOM) {
    console.log(`      Similar Elements Details:`);
    payload.elementDetails.similarElementsOnDOM.forEach((el: any, i: number) => {
      console.log(`      [${i + 1}] ${JSON.stringify(el)}`);
    });
  }
  console.log(`   Aria Snapshot (first 500 chars): ${ariaSnapshotStr.substring(0, 500)}`);
  console.log(`   === END PROMPT DEBUG ===\n`);

  // Extract semantic intent from original locator
  let semanticIntent = '';
  if (payload.failedLocator) {
    if (payload.failedLocator.includes('chat') || payload.failedLocator.includes('bot')) {
      semanticIntent = 'This locator appears to be looking for a chatbot-related element';
    } else if (payload.failedLocator.includes('username') || payload.failedLocator.includes('user-name')) {
      semanticIntent = 'This locator is looking for a username input field. Look for textbox with name "Username" or placeholder "Username"';
    } else if (payload.failedLocator.includes('password')) {
      semanticIntent = 'This locator is looking for a password input field. Look for textbox with name "Password" or placeholder "Password"';
    } else if (payload.failedLocator.includes('button')) {
      semanticIntent = 'This locator is looking for a button element';
    }
  }

  return `
You are a Playwright locator expert. Your task is identify the CORRECT locator for a failed element by analyzing the page structure and accessibility tree.

=== ORIGINAL FAILED LOCATOR (INCORRECT) ===
${payload.failedLocator}
${payload.elementDescription ? `
=== DEVELOPER-PROVIDED ELEMENT DESCRIPTION (HIGH-CONFIDENCE GROUND TRUTH) ===
The developer explicitly labeled this element as: "${payload.elementDescription}"
This is a direct statement of intent from the person who wrote the test - treat it as
more reliable than any inferred/heuristic signal below. Prioritize suggestions whose
role, label, text, or nearby context in the accessibility tree matches this description
over suggestions that only match on incidental attributes.
` : ''}
=== SEMANTIC INTENT ===
${semanticIntent || 'Determine the element type from context'}

=== ERROR REASON ===
${payload.error}

=== FAILED ELEMENT CONTEXT ===
Accessibility Snapshot:
${failedElementSnapshotStr}

Parent/Sibling Context:
${payload.contextHtml || 'N/A'}

=== ELEMENT ATTRIBUTES (Available for fallback selectors) ===
${payload.elementDetails ? `
Tag: ${payload.elementDetails.tagName}
ID: ${payload.elementDetails.id}
Name: ${payload.elementDetails.name}
Type: ${payload.elementDetails.type}
Placeholder: ${payload.elementDetails.placeholder}
Class: ${payload.elementDetails.className}
Data-TestID: ${payload.elementDetails.dataTestId}
Data-Test: ${payload.elementDetails.dataTest}
Data-ID: ${payload.elementDetails.dataId}
Aria-Label: ${payload.elementDetails.ariaLabel}
Role: ${payload.elementDetails.role}

Possible Fallback Selectors to Use:
${payload.elementDetails.possibleSelectors?.id ? `- ID selector: page.locator('${payload.elementDetails.possibleSelectors.id}')` : ''}
${payload.elementDetails.possibleSelectors?.dataTestId ? `- DataTestId: page.locator('${payload.elementDetails.possibleSelectors.dataTestId}')` : ''}
${payload.elementDetails.possibleSelectors?.dataTest ? `- DataTest: page.locator('${payload.elementDetails.possibleSelectors.dataTest}')` : ''}
${payload.elementDetails.possibleSelectors?.name ? `- Name: page.locator('${payload.elementDetails.possibleSelectors.name}')` : ''}
` : 'No element details available'}

=== SIMILAR ELEMENTS IN ARIA SNAPSHOT ===
${payload.elementDetails?.similarElementsInSnapshot ? `
These similar elements were found in the accessibility tree:
${payload.elementDetails.similarElementsInSnapshot.map((el: any) => `- ${el.type}: "${el.text}"`).join('\n')}

This tells us what attributes/characteristics similar elements have in the accessibility tree.
` : 'No similar elements found'}

=== SIMILAR ELEMENTS FOUND ON PAGE (ACTUAL ATTRIBUTES) ===
${payload.elementDetails?.similarElementsOnDOM ? `
These elements exist on the page with the following attributes:
${payload.elementDetails.similarElementsOnDOM.map((el: any, i: number) => `
[${i + 1}] 
  - Type/Role: ${el.type || el.role || 'unknown'}
  - Text: "${el.text || el.placeholder || 'N/A'}"
  - ID: ${el.id || 'NONE'}
  - Name: ${el.name || 'NONE'}
  - Placeholder: ${el.placeholder || 'NONE'}
  - Data-TestID: ${el.dataTestId || 'NONE'}
  - Data-Test: ${el.dataTest || 'NONE'}
  - Data-ID: ${el.dataId || 'NONE'}
  - Aria-Label: ${el.ariaLabel || 'NONE'}
`).join('\n')}

⚠️ KEY INSIGHT: Look at what attributes these similar elements ACTUALLY have!
If they all have data-testid, suggest using [data-testid].
If they have names, suggest using [name].
If they have IDs, suggest using ID selector.
If they have roles + text, suggest getByRole + name.
If they have placeholders, suggest getByPlaceholder.
` : 'No similar elements on DOM'}


=== COMPLETE PAGE ACCESSIBILITY TREE ===
This is the full accessibility tree. Use this to understand all available elements:
${ariaSnapshotStr.slice(0, 4000)}

=== VISUAL SCREENSHOT ===
Screenshot captured: ${payload.screenshot ? 'YES (visual context available)' : 'NO'}

=== INSTRUCTIONS ===

1. UNDERSTAND THE INTENT:
   - If the original locator has an ID like #chat-bot-launcher-button, find a button that launches a chatbot
   - If it says #user-name1234, find the username INPUT field
   - Don't just copy the suggestion blindly - understand what element type is needed

2. LOCATOR PRIORITY (in order of reliability):
   ✅ BEST - Playwright locators (semantic):
      a) getByRole('button', { name: '...' })
      b) getByRole('textbox', { name: '...' })
      c) getByPlaceholder('...')
      d) getByLabel('...')
      e) getByTestId('data-testid-value')
      f) getByText('...')
   
   ✅ GOOD - CSS/ID selectors (if element has unique id/class):
      g) page.locator('#element-id') - if element has ID attribute
      h) page.locator('.unique-class') - if element has unique class
      i) page.locator('[data-test="value"]') - if element has data attributes
      j) page.locator('[name="fieldname"]') - if element has name attribute
   
   ✅ LAST RESORT - XPath (only if nothing else works):
      k) page.locator('//xpath/to/element') - only when semantic locators fail
      l) Valid XPath examples: //button[@id="submit"], //input[@type="text"], //div[contains(@class, "error")]
      m) AVOID XPath with [text()="..."] - use @* attributes instead!
         ❌ WRONG: page.locator('//button[text()="Click"]')
         ✅ RIGHT: page.locator('//button[@id="click-btn"]') or page.locator('//button[contains(., "Click")]')

3. WHEN TO USE WHICH SELECTOR:
   - Element has UNIQUE id attribute → Use page.locator('#id') FIRST (most reliable!)
   - Element has role + accessible name → Use getByRole
   - Element has placeholder → Use getByPlaceholder
   - Element is associated with label → Use getByLabel
   - Element has visible text → Use getByText
   - Element has data-testid → Use getByTestId
   - Element has UNIQUE data-* attribute → Use page.locator('[data-attr="value"]')
   - Element has UNIQUE name attribute → Use page.locator('[name="fieldname"]')
   - NONE of above work → Use XPath: page.locator('//xpath')

4. FALLBACK STRATEGY:
   If Playwright semantic locators don't match any elements, try in this order:
   - ✅ FIRST: Does element have an ID? → Return page.locator('#user-name')  (MOST RELIABLE!)
   - Does element have a data attribute? → Return page.locator('[data-testid="username"]')
   - Does element have a unique class? → Return page.locator('.input-field')
   - Last resort → Return XPath: page.locator('//input[@placeholder="Username"]')
   ✅ MUST match EXACTLY ONE element in the accessibility tree
   ✅ Element must have correct role and accessible name
   ✅ Check for duplicates - if multiple elements match, pick the most specific one
   ✅ Element must be interactive (.click(), .fill(), .press(), etc.)

4. COMMON PATTERNS TO RECOGNIZE:
   - Input field with placeholder → Use getByPlaceholder() FIRST
   - Button with visible text → Use getByRole('button', { name: 'text' })
   - Form field labeled → Use getByLabel('label text')
   - Element with data-testid → May be in accessibility tree, use getByTestId()

5. DEBUGGING CHECKLIST:
   - Does the accessibility tree show a "textbox 'Username'"? → Use getByRole('textbox', { name: 'Username' })
   - Are there multiple matching elements? → Add more specificity (role + name combo)
   - Is the element hidden/disabled? → Still return it with confidence, let Playwright handle visibility
   - Element not in accessibility tree? → It might not have proper ARIA labels - try alternative strategies

=== CRITICAL: ELEMENT EXISTENCE CHECK ===

⚠️ IMPORTANT: Check if element is in the accessibility tree:
- If you can see the element in the aria-snapshot (look for button, link, input, etc. with matching text)
  → Generate locators to find it using semantic approaches first
  → Element EXISTS on the page, just selector is wrong
  
- If you CANNOT find the element in the aria-snapshot (element text not shown anywhere)
  → Element probably DOESN'T EXIST YET on the page
  → Try suggestions that look for SIMILAR elements instead
  → Examples: "page.locator('button')" instead of "page.locator('button:has-text(\"specific text\")')"
  → Or look for elements by role/type that ARE in the accessibility tree
  
Examples:
  ✅ Good: Accessibility tree shows "button 'Reset Password'" → Suggest page.getByRole('button', { name: /reset|password/i })
  ❌ Bad: Button 'Change existing Password' NOT in tree → Suggest page.getByRole('button', { name: 'Change existing Password' }) (element doesn't exist!)

=== CRITICAL ===
- The original locator FAILED because it's wrong (bad ID, wrong selector, etc.) OR element doesn't exist yet
- Your job: Find the ACTUAL element using Playwright's query methods
- If Playwright semantic locators don't work (getByRole, getByText, etc.):
  ✅ TRY FALLBACK SELECTORS FIRST:
     1. Use element ID if available: page.locator('#element-id')
     2. Use data-testid if available: page.locator('[data-testid="value"]')
     3. Use name attribute if available: page.locator('[name="fieldname"]')
     4. Use placeholder if available: getByPlaceholder('text')
  ✅ ONLY use XPath as absolute last resort
- Do NOT return raw XPath unless the element has no accessible role/name or data attributes
- If element is not in accessibility tree AND not findable by attributes:
  → Return generic selectors: page.locator('button'), page.locator('input'), etc.
  → This allows testing to find any element of that type
  → Element may be loading/appearing after test steps

Return ONLY valid JSON array with 3-5 ALTERNATIVE locator suggestions, ordered by confidence (highest first):

⚠️ CRITICAL: If element has an ID in the possible selectors section:
   - FIRST suggestion MUST be the ID selector: page.locator('#element-id')
   - Confidence for ID selector: 0.98-1.0
   - This is the most reliable approach!

[
  {
    "locator": "page.locator('#element-id')",
    "confidence": 0.99,
    "reasoning": "Direct ID selector - element has unique id attribute, most reliable approach"
  },
  {
    "locator": "page.getByPlaceholder('Username')",
    "confidence": 0.95,
    "reasoning": "Element has placeholder='Username' - semantic approach as backup"
  },
  {
    "locator": "page.locator('input[placeholder=\"Username\"]')",
    "confidence": 0.90,
    "reasoning": "CSS selector targeting input with placeholder attribute - reliable fallback"
  },
  {
    "locator": "page.locator('[name=\"username\"]')",
    "confidence": 0.85,
    "reasoning": "Name attribute selector - works if element has name attribute"
  },
  {
    "locator": "page.locator('input[type=\"text\"]').first()",
    "confidence": 0.70,
    "reasoning": "Generic text input selector - less specific but may match target element"
  }
]

=== CRITICAL ===
1. If the "Possible Fallback Selectors" section shows an ID (like id="#encPassword"):
   ✅ ALWAYS suggest the ID selector FIRST as suggestion #1
   ✅ Give it confidence 0.98-1.0
   ✅ This is more reliable than semantic locators!

2. If the element has other attributes (data-testid, name, etc.):
   ✅ Suggest those as alternatives in order of reliability

3. Do NOT skip ID-based selectors!
   ❌ BAD: Element has id="password" but all suggestions use getByRole/getByPlaceholder
   ✅ GOOD: First suggestion is page.locator('#password')

=== CRITICAL INSTRUCTIONS FOR MULTIPLE SUGGESTIONS ===
1. Provide AT LEAST 3 suggestions, UP TO 5 maximum
2. ORDER by confidence (highest first) - healer will try them in this order
3. Each suggestion must be a VALID Playwright locator string
4. Vary the approach across suggestions:
   - Suggestion 1: Best semantic locator (getByRole, getByPlaceholder, etc.)
   - Suggestion 2: CSS/ID selector if available
   - Suggestion 3: Alternative CSS/attribute selector
   - Suggestion 4: Generic selector as fallback
   - Suggestion 5: XPath only if all else fails
5. CONFIDENCE should decrease down the list
6. All suggestions should target the SAME element
7. Do NOT return duplicates or identical locators
8. Each locator MUST be a string (not an object)

Remember: The healer will try each suggestion in order until one succeeds!
`;
}
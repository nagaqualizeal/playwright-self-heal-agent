# 📦 Installation & Usage Guide

## ✅ Testing Complete - Ready to Use!

### Package Details
- **File:** `playwright-self-heal-agent-1.0.0.tgz`
- **Size:** 183.5 KB
- **Date:** May 22, 2026
- **Status:** ✅ **VERIFIED & TESTED**

---

## 🚀 Installation in Your Playwright Project

### Step 1: Copy the Package
Copy `playwright-self-heal-agent-1.0.0.tgz` to your Playwright project directory:

```bash
# From the agent directory
cd d:\Agents\playwright-self-heal-agent

# Copy to your Playwright project
copy playwright-self-heal-agent-1.0.0.tgz C:\path\to\your\playwright-project\
```

### Step 2: Install in Your Project
```bash
cd C:\path\to\your\playwright-project

npm install ./playwright-self-heal-agent-1.0.0.tgz
```

### Step 3: Create Custom Test Fixture

Create `src/fixtures/healerFixture.ts` in your Playwright project:

```typescript
import { test as base, expect } from '@playwright/test';
import { register } from 'playwright-self-heal-agent';

export const test = base.extend({
  page: async ({ page, context }, use, testInfo) => {
    // Attach test metadata for better reports
    (page as any).__testInfo = {
      title: testInfo.title,
      file: testInfo.file,
      suite: testInfo.titlePath.join(' › '),
      fileName: testInfo.file.split(/[/\\]/).pop(),
    };
    
    // Register healer on main page
    register(page);
    
    // Auto-register new pages created during test (multi-page scenarios)
    context.on('page', (newPage) => {
      (newPage as any).__testInfo = (page as any).__testInfo;
      register(newPage);
    });
    
    await use(page);
  },
});

export { expect };
```

### Step 4: Update Your Test Files

Use the custom fixture in your tests:

```typescript
import { test, expect } from '../fixtures/healerFixture';

test('should login and perform action', async ({ page }) => {
  await page.goto('https://example.com/login');
  
  // If these locators break, self-healer will automatically suggest alternatives
  await page.fill('#username', 'testuser');
  await page.fill('#password', 'testpass123');
  await page.click('#login-button');
  
  await expect(page.locator('.welcome-message')).toBeVisible();
});

test('multi-page scenario', async ({ page, context }) => {
  // First page
  await page.goto('https://example.com/forgot-password');
  await page.fill('#email', 'test@example.com');
  await page.click('#reset-link');
  
  // Second page (new tab/window)
  const newPage = await context.waitForEvent('page');
  await newPage.fill('#token', '123456');
  await newPage.click('#confirm');
  
  // Both pages automatically have healing enabled!
});
```

### Step 5: Add Configuration (Optional)

### Step 5: Configure LLM Provider (Optional)

Create `.selfhealrc.json` in your project root:

```json
{
  "llmProvider": "claude",
  "claude": {
    "model": "claude-3-5-sonnet-20241022"
  },
  "openai": {
    "model": "gpt-4-turbo"
  },
  "cacheDir": ".selfheal-cache.json"
}
```

### Step 6: Set Environment Variables

Set your API key for the LLM provider:

**Windows (PowerShell):**
```powershell
# For Claude
$env:CLAUDE_API_KEY='sk-ant-...'

# Or for OpenAI
$env:OPENAI_API_KEY='sk-...'
```

**Windows (Command Prompt):**
```cmd
set CLAUDE_API_KEY=sk-ant-...
```

**macOS/Linux:**
```bash
export CLAUDE_API_KEY=sk-ant-...
```

### Step 7: Run Your Tests

```bash
npx playwright test
```

---

## 📋 What Happens When a Test Fails

When a locator fails, the self-healer automatically:

1. **Captures Context**
   - Takes a screenshot of the page
   - Extracts accessibility tree (aria-snapshot)
   - Identifies the failed locator and error

2. **Calls LLM**
   - Sends screenshot + aria-snapshot to Claude or OpenAI
   - Requests 5 alternative locator suggestions
   - LLM ranks suggestions by confidence

3. **Validates Suggestions**
   - Tests each suggestion on the page
   - **PASS 1 (STRICT)**: Looks for exactly 1 matching element
   - **PASS 2 (RELAXED)**: Accepts 1+ matches (logs warning if duplicates)
   - Stops at first valid suggestion

4. **Reports Results**
   - Logs healing attempt details
   - Records in cache for future use
   - Returns healed element to continue test

---

## 📊 Healing Report Example

When tests complete, check `self-heal-report.json`:

```json
{
  "summary": {
    "totalTests": 5,
    "totalHeals": 3,
    "successRate": "100%"
  },
  "heals": [
    {
      "testName": "[login.spec.ts] User Login › should enter credentials",
      "action": "click",
      "originalLocator": "#login-btn-wrong",
      "healedLocator": "page.getByRole('button', { name: 'Login' })",
      "strategy": "PASS 1 (STRICT MODE)",
      "attempts": 1,
      "status": "SUCCESS"
    },
    {
      "testName": "[password.spec.ts] Password Reset › should fill password",
      "action": "fill",
      "originalLocator": "#pass",
      "healedLocator": "page.locator('[aria-label=\"Password\"]').first()",
      "strategy": "PASS 2 (RELAXED MODE)",
      "duplicateElements": 2,
      "attempts": 3,
      "status": "SUCCESS"
    }
  ]
}
```

---

## ✅ Verification Checklist

Before running tests:

- [ ] ✅ Package installed: `npm ls playwright-self-heal-agent`
- [ ] ✅ Fixture created: `src/fixtures/healerFixture.ts`
- [ ] ✅ Test file imports fixture: `import { test } from '../fixtures/healerFixture'`
- [ ] ✅ Environment variable set: `CLAUDE_API_KEY` or `OPENAI_API_KEY`
- [ ] ✅ `.selfhealrc.json` created (optional but recommended)
- [ ] ✅ Tests run: `npx playwright test`

---

## 🔍 Debugging Healing Attempts

If healing doesn't work as expected:

1. **Check fixture is properly imported**
   ```typescript
   // ✅ Correct
   import { test } from '../fixtures/healerFixture';
   
   // ❌ Wrong
   import { test } from '@playwright/test';
   ```

2. **Verify API key is set**
   ```bash
   $env:CLAUDE_API_KEY  # Windows
   echo $CLAUDE_API_KEY  # macOS/Linux
   ```

3. **Enable debug logging**
   ```bash
   DEBUG=pw:api npx playwright test
   ```

4. **Check healing report**
   ```bash
   cat self-heal-report.json
   ```

---

## 📁 Files to Commit to Git

**Keep these in your repo:**
- ✅ `src/fixtures/healerFixture.ts` - Your custom fixture
- ✅ `src/tests/` - Your test files
- ✅ `package.json` - Updated with self-heal-agent dependency

**Ignore these:**
- ❌ `.selfheal-cache.json` - Add to `.gitignore` (generated cache)
- ❌ `self-heal-report.json` - Generated during test runs
- ❌ `node_modules/` - Dependencies (already in .gitignore)
- ❌ `.env` - Secrets (add to .gitignore)

### Add to `.gitignore`

```
# Self-heal agent cache
.selfheal-cache.json
.selfheal-report.json

# Environment variables
.env
.env.local

# Dependencies
node_modules/

# IDE
.vscode/
.idea/
```

---

## 🎉 You're All Set!

Your Playwright tests now have intelligent self-healing with:
- ✅ Automatic selector healing
- ✅ Multi-page support
- ✅ LLM-powered suggestions
- ✅ Detailed healing reports
- ✅ Duplicate element handling
- ✅ Test metadata tracking

Happy testing! 🚀


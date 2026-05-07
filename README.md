# Playwright Self-Heal Agent

An intelligent Playwright test framework extension that automatically detects and heals broken selectors/locators using AI (OpenAI or Claude). When a test fails due to a missing or invalid element locator, this agent suggests alternative selectors and validates them before updating your tests.

## Features

- 🤖 **AI-Powered Healing**: Uses LLM (OpenAI/Claude) to suggest alternative selectors
- 🔄 **Automatic Caching**: Caches healed selectors to avoid redundant API calls
- ✅ **Validation**: Validates suggested selectors before applying them
- 📝 **Detailed Reporting**: Logs all healing attempts with timestamps and results
- 🔧 **Easy Integration**: Works seamlessly with Playwright Test framework
- ⚡ **Fast Recovery**: Pre-checks and caches reduce test execution overhead

## Architecture Overview

This project consists of two separate workflows:

### 🔨 Agent Framework (This Repository)
- **Location**: `d:\Agents\playwright-self-heal-agent`
- **Purpose**: Develop, test, and package the self-healing agent
- **Steps**: 
  1. `npm install` → Install dependencies
  2. `npm run build` → Compile TypeScript
  3. `npm pack` → Generate `.tgz` package
- **Output**: `playwright-self-heal-agent-1.0.0.tgz` (distributable package)

### 🎭 Playwright Framework (Your Test Project)
- **Location**: Your separate test project (e.g., `d:\MyTestProject`)
- **Purpose**: Use the agent to run tests with automatic selector healing
- **Steps**:
  1. `npm install /path/to/playwright-self-heal-agent-1.0.0.tgz` → Install agent
  2. Add `.selfhealrc.json` and `.env` → Configure
  3. `import { test } from 'playwright-self-heal-agent'` → Use in tests
  4. Run tests and healing happens automatically
- **Artifacts**: `.selfheal-cache.json`, `self-heal-report.json` (generated during tests)

## .gitignore vs .npmignore

These are **two different files** with different purposes:

| Aspect | `.gitignore` | `.npmignore` |
|--------|--------------|--------------|
| **Purpose** | Controls what files Git **ignores** (doesn't commit to repo) | Controls what files npm **excludes** from package (not included in `.tgz`) |
| **When used** | When running `git add`, `git commit` | When running `npm pack` or `npm publish` |
| **Example** | Exclude `node_modules/`, `.env`, `dist/` | Exclude `src/`, `tsconfig.json`, `.env` |
| **If missing** | Git commits everything (bad!) | npm includes everything (bloats package) |

### Real-world example for this project:

**`.gitignore`** (what stays in repo):
```
node_modules/         ← Don't commit dependencies
.env                  ← Don't commit secrets
```
✅ **DO commit**: `src/`, `dist/`, `package.json`, `package-lock.json`

**`.npmignore`** (what goes in npm package):
```
src/                  ← Don't include source TypeScript (compiled .js exists)
.env                  ← Don't include secrets
tsconfig.json         ← Don't include build config
tests/                ← Don't include test files
node_modules/         ← Don't include dependencies
.git/                 ← Don't include git history
```
✅ **DO include**: `dist/` (compiled .js), `package.json`, `README.md`, `LICENSE`

### Result:
- **Git repo** has: source files + compiled output
- **NPM package** has: only compiled output (slim & production-ready)

### Checking Your Files:

**[Agent Framework]** - View what's being excluded:

```bash
# See what .gitignore excludes
cat .gitignore

# See what .npmignore excludes  
cat .npmignore
```

This ensures:
1. You track everything needed for development in Git
2. You ship only necessary files in the npm package



### Source Files (`src/`)

| File | Purpose |
|------|---------|
| **register.ts** | Entry point that extends Playwright's `test` object with self-healing capabilities. Patches the page object for all tests. |
| **patcher.ts** | Intercepts Playwright page methods (click, fill, etc.) and triggers healing when actions fail or selectors are not found. |
| **analyzer.ts** | Analyzes error messages to determine the error type (primarily detects locator/selector errors). |
| **llmClient.ts** | Communicates with LLM providers (OpenAI or Claude) to get suggestions for alternative selectors. Reads configuration from `.selfhealrc.json`. |
| **resolver.ts** | Converts LLM-suggested selector strings into actual Playwright locator objects (handles xpath, getByRole, getByText, CSS selectors). |
| **validator.ts** | Validates suggested locators by checking if they exist and are visible on the page before applying them. |
| **healer.ts** | Main healing orchestrator that combines analyzer, LLM client, resolver, and validator to fix broken selectors. Manages caching via `.selfheal-cache.json`. |
| **cache.ts** | Utility functions for reading/writing cached locators to prevent redundant LLM API calls. |
| **reporter.ts** | Logs all healing attempts to `self-heal-report.json` with status, original selector, healed selector, and timestamp. Prevents duplicate entries. |

## Installation & Setup

There are **two separate workflows**: one for developing the Agent Framework itself, and another for using it in your Playwright Framework project.

---

### 🔨 Agent Framework Setup (Developer)

This section applies if you're **developing or modifying the self-heal agent itself**.

#### Prerequisites
- Node.js >= 16
- Playwright >= 1.40.0
- API key for OpenAI or Claude (depending on your LLM choice)

#### Install Dependencies

**[Agent Framework]** - Install agent dependencies:
```bash
npm install
```

#### Configuration

**[Agent Framework]** - Create a `.selfhealrc.json` file in the agent root:

```json
{
  "llmProvider": "openai",
  "openai": {
    "model": "gpt-4"
  },
  "claude": {
    "model": "claude-3-sonnet-20240229"
  }
}
```

**[Agent Framework]** - Create a `.env` file for API keys:

```env
OPENAI_API_KEY=sk-your-key-here
CLAUDE_API_KEY=sk-ant-your-key-here
```

#### Build

**[Agent Framework]** - Compile TypeScript to JavaScript:

```bash
npm run build
```

This generates compiled `.js` and `.d.ts` files in the `dist/` directory.

#### Pack

**[Agent Framework]** - Create a distributable package:

```bash
npm pack
```

This generates `playwright-self-heal-agent-1.0.0.tgz` that can be published to npm or used locally.

---

### 🎭 Playwright Framework Setup (Consumer)

This section applies if you're **using the self-heal agent in your Playwright test project**.

#### Install from Package

**[Playwright Framework]** - Install the agent package in your test project:

```bash
npm install /path/to/playwright-self-heal-agent-1.0.0.tgz
```

Or if using npm:
```bash
npm install playwright-self-heal-agent-1.0.0.tgz
```

#### Configuration

**[Playwright Framework]** - Copy the configuration files to your Playwright project root:

Create `.selfhealrc.json`:
```json
{
  "llmProvider": "openai",
  "openai": {
    "model": "gpt-4"
  },
  "claude": {
    "model": "claude-3-sonnet-20240229"
  }
}
```

Create `.env` with your API keys:
```env
OPENAI_API_KEY=sk-your-key-here
CLAUDE_API_KEY=sk-ant-your-key-here
```

## Usage in Playwright Framework

**[Playwright Framework]** - Follow these steps in your test project (not the agent framework).

### 1. Import the Extended Test Object

**[Playwright Framework]** - In your test file (`tests/example.spec.ts`):

```typescript
import { test, expect } from 'playwright-self-heal-agent';

test('example test with self-healing', async ({ page }) => {
  await page.goto('https://example.com');
  
  // If this selector fails, the agent will auto-heal it
  await page.click('button.old-selector-that-no-longer-exists');
  
  // Continue with assertions
  expect(await page.isVisible('button')).toBe(true);
});
```

### 2. How It Works

1. **Test Execution**: Your test runs normally with the patched `page` object
2. **Failure Detection**: If `page.click()`, `page.fill()`, or other actions fail:
   - Pre-check: Immediately checks if the element exists
   - If not found, healing is triggered
3. **LLM Analysis**: The original selector is sent to the LLM with page context
4. **Suggestion**: LLM returns alternative selectors to try
5. **Validation**: Each suggestion is tested on the actual page
6. **Application**: First valid selector is applied and cached
7. **Logging**: Result is logged to `self-heal-report.json`

### 3. Monitor Healing Results

**[Playwright Framework]** - Check the healing report:

```bash
cat self-heal-report.json
```

Sample output:
```json
[
  {
    "original": "button.old-class",
    "healed": "button:has-text('Submit')",
    "action": "click",
    "status": "healed",
    "test": "example-suite → example test",
    "timestamp": "2024-05-04T10:30:45.123Z"
  }
]
```

### 4. Check Cache

**[Playwright Framework]** - Cached selectors are stored in `.selfheal-cache.json`:

```json
{
  "button.old-class": "button:has-text('Submit')",
  "input#email": "input[placeholder='Email Address']"
}
```

## Example Test File

**[Playwright Framework]** - Complete example:

```typescript
import { test, expect } from 'playwright-self-heal-agent';

test.describe('Login Tests', () => {
  test('user can login', async ({ page }) => {
    await page.goto('https://app.example.com/login');
    
    // These might be broken, but the agent will fix them
    await page.fill('input[name=email]', 'user@example.com');
    await page.fill('input[name=password]', 'password123');
    await page.click('button.login-btn');
    
    // Verify success
    await page.waitForURL('**/dashboard');
    expect(await page.isVisible('text=Dashboard')).toBe(true);
  });
});
```

## Environment Variables

**[Playwright Framework]** - Set these in your test project's `.env` file:

- `OPENAI_API_KEY`: Your OpenAI API key (if using OpenAI)
- `CLAUDE_API_KEY`: Your Anthropic Claude API key (if using Claude)

## Supported LLM Providers

- **OpenAI**: GPT-4, GPT-3.5-turbo
- **Claude**: Claude 3 Sonnet, Claude 3 Opus

## Troubleshooting

**[Playwright Framework]** - Common issues and solutions:

### No healing happening
- Check `.selfhealrc.json` exists and is valid JSON in your test project
- Verify API key is set in `.env`
- Check console logs for error messages
- Ensure agent package is installed: `npm list playwright-self-heal-agent`

### Module not found error
- **Error**: `Cannot find module './patcher'`
- **Solution**: Ensure compiled `.js` files are included in the package (check `.npmignore`)
- **Fix**: Rebuild agent: `npm run build && npm pack`

### API rate limits
- The caching mechanism reduces unnecessary API calls
- Configure model in `.selfhealrc.json` to use a faster/cheaper model
- Review `.selfheal-cache.json` to see what's already cached

### Invalid suggestions
- Improve your test's error context
- Consider using more specific selectors initially
- Review suggestions in `self-heal-report.json`

## Performance Tips

**[Playwright Framework]** - Optimize healing performance:

1. **Use caching**: The first healed selector is cached automatically in `.selfheal-cache.json`
2. **Monitor logs**: Review `self-heal-report.json` regularly to identify patterns
3. **Update tests**: After healing, manually review and update your test code for long-term stability
4. **API costs**: Use Claude for cost savings or GPT-3.5 for basic healing
5. **Batch operations**: Group similar test scenarios to maximize cache hits

---

## 🔧 Recent Fixes & Improvements (May 6, 2026)

### Issue: Missing Compiled JavaScript Files in NPM Package

**Problem**: When installing `playwright-self-heal-agent` from the `.tgz` file, the distributed package was missing compiled `.js` files. This caused the following error when running tests:

```
Error: Cannot find module './patcher'
Require stack:
- node_modules/playwright-self-heal-agent/dist/register.js
```

**Root Cause**: The `.gitignore` file was excluding all `.js` files globally, which prevented the compiled `dist/*.js` files from being included in the npm package when running `npm pack`.

### Solution Applied

#### 1. Created `.npmignore` File
Added a new `.npmignore` file to explicitly control which files are packaged. This allows distribution of compiled `.js` files while excluding source TypeScript files and dependencies:

```
# Dependencies (excluded)
node_modules/

# Source files (excluded)
src/
tsconfig.json

# Environment & build (excluded)
.env
.env.local
.env.*.local
build/

# Tests (excluded)
*.test.js
*.spec.js
test/
tests/
docs/

# Package manager (excluded)
yarn.lock
package-lock.json

# But dist/ files ARE included automatically
# (.npmignore doesn't need to explicitly allow dist/)
```

#### 2. Rebuilt the Package
```bash
npm pack
```

This generated a complete `playwright-self-heal-agent-1.0.0.tgz` with all necessary compiled files:
- ✅ `dist/analyzer.js` (438 B)
- ✅ `dist/cache.js` (650 B)
- ✅ `dist/healer.js` (7.2 KB)
- ✅ `dist/llmClient.js` (3.4 KB)
- ✅ `dist/patcher.js` (4.2 KB) ← **Previously missing - caused the error**
- ✅ `dist/register.js` (479 B)
- ✅ `dist/reporter.js` (1.1 KB)
- ✅ `dist/resolver.js` (692 B)
- ✅ `dist/validator.js` (435 B)

#### 3. Package Information
- **File Size**: 7.8 KB (compressed)
- **Unpacked Size**: 26.9 KB
- **Total Files**: 20
- **Status**: Ready for distribution

### Files Changed
- ✅ **Created**: `.npmignore` - Controls npm package distribution
- ✅ **Rebuilt**: `playwright-self-heal-agent-1.0.0.tgz` - Complete package with all .js files

### Result
✅ All compiled modules now properly load  
✅ Self-healing functionality works as expected  
✅ Tests can successfully import `from 'playwright-self-heal-agent'`  
✅ Cache system functioning correctly  
✅ Error handling strategies (rule-based and LLM-based) operational  

### Implementation Notes for Consumers

When installing this package, ensure a clean install to get the latest fixes:

```bash
# Remove old installation
rm -rf node_modules package-lock.json

# Fresh install
npm install
```

Or if using the local .tgz file:
```bash
npm install /path/to/playwright-self-heal-agent-1.0.0.tgz
```

### Key Lessons Learned

1. **`.npmignore` vs `.gitignore`**: Always use `.npmignore` for npm packages to control distribution content
2. **Global Exclusions**: The `.gitignore` rules apply to `npm pack` unless explicitly overridden by `.npmignore`
3. **Distribution Validation**: Always verify that compiled/built files are included in the distributed package
4. **Local Testing**: Test package locally before distribution using `npm install ./package.tgz`
5. **Transparency**: Document all fixes and improvements for package consumers

---

## License

MIT

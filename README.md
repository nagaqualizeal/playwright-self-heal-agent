# QASH — Qualizeal Automation Self Healer

AI-powered self-healing for Playwright locators. When a `click`, `fill`, or similar
action fails because its locator broke, QASH captures the page's accessibility
tree, asks a configured AI provider to find the element's new location, retries
the action, and — if it worked — caches the fix so the same call site never
pays for another AI call.

## Install

```sh
npm install qash-playwright
```

## Configure a provider

Copy `.env.example` to `.env` and fill in one provider:

```sh
HEALER_ENABLED=true
HEALER_PROVIDER=openai   # openai | anthropic | gemini | ollama | ollama-local

OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-...
```

See `.env.example` for the other providers' variables.

## Set `actionTimeout` in your `playwright.config.ts`

Playwright lets a broken locator retry silently for your entire test `timeout`
before it ever throws — which means QASH never gets a turn, since it only
activates once an action actually fails. Set `actionTimeout` well below your
test `timeout`:

```ts
export default defineConfig({
  timeout: 30_000,
  use: {
    actionTimeout: 10_000,
  },
});
```

QASH reads this same value as its own healing budget, so a slow provider call
can never outlast the timeout your project already configured.

## Use it in your tests

Change one import — everything else about how you write tests stays the same:

```ts
// Before
import { test, expect } from '@playwright/test';

// After
import { test, expect } from 'qash-playwright';
```

```ts
import { test, expect } from 'qash-playwright';

test('logs in', async ({ page }) => {
  await page.goto('/');
  await page.locator('input[name="username"]').describe('Username textbox').fill('demo');
  await page.locator('button[type="submit"]').describe('Login button').click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

New tabs, popups, and elements inside `<iframe>`s are healing-aware automatically
— no extra fixture or wrapping needed for any of them.

Not using the `@playwright/test` fixtures? Wrap a page manually:

```ts
import { bind } from 'qash-playwright';

const page = bind(await context.newPage());
```

### A quick tip for better results

Chain `.describe('...')` onto a locator so QASH knows what it's actually
looking for — this matters most for plain CSS/XPath selectors, which carry no
readable intent of their own:

```ts
const usernameField = page.locator('input[name="username"]').describe('Username textbox');
```

If you skip `.describe()` but name your locator variables descriptively
(`txtUsername`, `submitButton`), QASH decodes that name into the same kind of
description for free — `.describe()` still wins when both are present.

## What gets healed, and what never does

QASH only ever touches `click`, `fill`, `check`, `uncheck`, `selectOption`,
`press`, `type`, `hover`, `tap`, `focus`, `waitFor`, `scrollIntoViewIfNeeded`,
and `setInputFiles`. Everything else — `isVisible`, `isHidden`, `count`, `all`,
and every `expect(...)` assertion — is never intercepted at all, so a
conditional check like `if (await locator.isVisible())` is never healed and
never affected by QASH being installed.

Within the methods above, two situations are deliberately skipped even when
the action fails:

- **The element was found but couldn't be acted on** (hidden, disabled,
  covered, still animating). Playwright's own error text says as much — in
  that case the locator wasn't the problem, so swapping it can't fix it and
  risks silently acting on the wrong element instead.
- **A `waitFor({ state: 'hidden' | 'detached' })` times out.** That kind of
  wait is confirming something is *gone* — there's no such thing as "a better
  locator for something that shouldn't exist." `waitFor({ state: 'visible' }
  )` (or the default `'attached'`), the common "wait for it, then interact"
  pattern, is healed like any other action.

## Reports

Every heal attempt is written to `qash-heal-report.json` and rendered as
`qash-heal-report.html`, reset at the start of each test run. Each entry
records the test name, the **page URL** the failure happened on, the source
`file:line` the locator was declared at, the original and healed locator, and
— on failure — why every candidate was rejected.

The same information is also mirrored into **Playwright's own HTML report**
(`playwright-report/index.html`, or whatever `reporter` your project
configures): every heal, cache hit, or heal failure shows up as an annotation
on its test (`qash-healed`, `qash-cache-hit`, `qash-heal-failed`), with the
full entry attached as downloadable JSON. Click into an individual test to see
it — the report's landing page itself still just shows pass/fail, same as
without QASH.

## Caching

A successful heal is cached by **selector + declaration site**, not by
selector text alone — so two different pages that happen to share a broken
selector never cross-apply a fix computed for the wrong element. A cache hit
skips both the AI call and, for locator-based actions, the wait itself: the
cached locator is tried immediately instead of waiting through the full
`actionTimeout` first.

Cached fixes live in `.qash-cache.json` on disk and persist across every local
run. In CI, where each run typically starts from a fresh checkout, the cache
doesn't carry over between runs — `qash-playwright apply` (below) landing the
fix into source is what actually stops repeat AI calls there.

## `qash-playwright checkup`

Validates your setup before you rely on it:

```sh
npx qash-playwright checkup
```

Checks provider connectivity (a real call, within your actual configured
timeout), whether `actionTimeout` is set and has real headroom below your test
`timeout`, which locators are missing a `.describe()` label, and which
locators are declared directly in test files instead of a Page Object.

## `qash-playwright apply`

A runtime heal is a point-in-time fix — it's only as durable as the AI's guess
happened to be for that one run. `apply` reads every successful heal and
rewrites the actual source line it came from, so future runs don't need to
heal (or pay for an AI call) at all:

```sh
npx qash-playwright apply --dry-run   # preview the changes
npx qash-playwright apply             # write them (asks to confirm interactively)
npx qash-playwright apply --yes       # write without prompting (CI/scripted use)
```

Nothing is ever committed automatically — review the diff yourself before
committing, the same way you would any other code change.

## Config file

`qash.config.json` (optional) can override where QASH reads tests from and
writes its report/cache:

```json
{
  "testDir": "tests",
  "reportJsonPath": "qash-heal-report.json",
  "reportHtmlPath": "qash-heal-report.html",
  "cachePath": ".qash-cache.json"
}
```

## Trying it in an existing project

To evaluate QASH against a real test suite rather than a fresh install:

1. Build and pack it from source: `npm run build && npm pack` (produces
   `qash-playwright-<version>.tgz`).
2. In your test project: `npm install /path/to/qash-playwright-<version>.tgz`.
3. Copy `.env.example` to `.env` in your project root and configure one provider.
4. Change your test files' import from `@playwright/test` to `qash-playwright`
   (or from whatever custom fixture you were using before). If you had a
   fixture whose only job was registering a self-healer on new pages/tabs, it
   can be deleted — QASH covers that automatically.
5. Make sure `use.actionTimeout` is set in `playwright.config.ts` (see above).
6. Run `npx qash-playwright checkup` to confirm the provider is reachable and
   see any locator-hygiene warnings before running anything.
7. Run your suite as normal (`npx playwright test`). Check `qash-heal-report.html`
   for the aggregate view, or your usual Playwright report for the per-test
   annotations.

Since this evaluates real, possibly-sensitive test flows, start with a
disposable/throwaway branch and a provider you're comfortable sending page
content to.

## Not in this version

- Vision-based (screenshot) healing — text/accessibility-tree healing only, for now.
- Subscription-based providers (using an existing Claude Code / GitHub Copilot
  login instead of an API key) — the four providers above all use a plain API key.
- A dedicated Cucumber integration — `bind(page)` works from any runner's own
  hooks today, but there's no packaged Cucumber-specific wiring yet.

## License

MIT

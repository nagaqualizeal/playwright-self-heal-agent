import { Page, Locator, FrameLocator, BrowserContext } from '@playwright/test';
import { heal, tryHealFromCache } from './heal';
import { captureCallSite, SourceLocation } from './sourceLocation';

const ACTION_METHODS = new Set([
  'click', 'dblclick', 'fill', 'check', 'uncheck', 'selectOption',
  'press', 'type', 'hover', 'tap', 'focus', 'waitFor',
  'scrollIntoViewIfNeeded', 'setInputFiles',
]);

// Page-level legacy convenience methods that take a selector string as their
// first argument, rather than being called on a Locator.
const PAGE_STRING_ACTION_METHODS = new Set([
  'click', 'dblclick', 'fill', 'check', 'uncheck', 'selectOption',
  'press', 'hover', 'tap', 'focus', 'setInputFiles',
]);

const LOCATOR_FACTORY_METHODS = new Set([
  'locator', 'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder',
  'getByTestId', 'getByAltText', 'getByTitle',
]);

const CHAIN_METHODS = new Set(['filter', 'and', 'or', 'first', 'last', 'nth', 'describe']);

type Ctx = {
  page: Page;
  target: Page | FrameLocator;
  sourceLocation: SourceLocation | null;
  getTestName: () => string;
};

const knownProxies = new WeakSet<object>();
const pageProxies = new WeakMap<Page, Page>();
const contextProxies = new WeakMap<BrowserContext, BrowserContext>();

function extractActionOptions(args: any[]): { state?: string } | undefined {
  const last = args[args.length - 1];
  return last && typeof last === 'object' && !Array.isArray(last) ? last : undefined;
}

export function wrapLocator(raw: Locator, ctx: Ctx): Locator {
  if (knownProxies.has(raw)) return raw;

  const proxy = new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);

      if (ACTION_METHODS.has(prop)) {
        return async (...args: any[]) => {
          const cacheProbe = await tryHealFromCache({
            page: ctx.page,
            target: ctx.target,
            originalLocator: target,
            method: prop,
            args,
            sourceLocation: ctx.sourceLocation,
            testName: ctx.getTestName(),
          });
          if (cacheProbe.ok) return cacheProbe.result;

          try {
            return await (target as any)[prop](...args);
          } catch (error) {
            return heal({
              page: ctx.page,
              target: ctx.target,
              originalLocator: target,
              method: prop,
              args,
              error,
              actionOptions: extractActionOptions(args),
              sourceLocation: ctx.sourceLocation,
              testName: ctx.getTestName(),
            });
          }
        };
      }

      if (prop === 'frameLocator') {
        return (...args: any[]) => {
          const rawFrame = (target as any).frameLocator(...args);
          return wrapFrameLocator(rawFrame, { ...ctx, target: rawFrame });
        };
      }

      if (LOCATOR_FACTORY_METHODS.has(prop) || CHAIN_METHODS.has(prop)) {
        return (...args: any[]) => {
          const result = (target as any)[prop](...args);
          return wrapLocator(result, ctx);
        };
      }

      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  knownProxies.add(proxy);
  return proxy;
}

export function wrapFrameLocator(raw: FrameLocator, ctx: Ctx): FrameLocator {
  if (knownProxies.has(raw)) return raw;

  const proxy = new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);

      if (prop === 'frameLocator') {
        return (...args: any[]) => {
          const rawFrame = (target as any).frameLocator(...args);
          return wrapFrameLocator(rawFrame, { ...ctx, target: rawFrame });
        };
      }

      if (LOCATOR_FACTORY_METHODS.has(prop)) {
        return (...args: any[]) => {
          const sourceLocation = captureCallSite();
          const result = (target as any)[prop](...args);
          return wrapLocator(result, { ...ctx, sourceLocation });
        };
      }

      if (prop === 'first' || prop === 'last' || prop === 'nth') {
        return (...args: any[]) => wrapFrameLocator((target as any)[prop](...args), ctx);
      }

      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  knownProxies.add(proxy);
  return proxy;
}

// A page/context created mid-test (a popup, a new tab) has no test name of its
// own — carrying it over from whatever opened it is what lets a heal on that
// new page still show up against the right test in the report, instead of
// "unknown-test".
function propagateTestName(source: any, target: any) {
  if (source?.__qashTestName && !target.__qashTestName) {
    target.__qashTestName = source.__qashTestName;
  }
}

function wrapPopupHandler(handler: any, source: any, wrap: (p: Page) => Page) {
  if (typeof handler !== 'function') return handler;
  return (page: Page, ...rest: any[]) => {
    propagateTestName(source, page);
    return handler(wrap(page), ...rest);
  };
}

export function wrapPage(raw: Page): Page {
  if (knownProxies.has(raw)) return raw;
  const existing = pageProxies.get(raw);
  if (existing) return existing;

  const getTestName = () => (raw as any).__qashTestName || 'unknown-test';
  let boundContext: BrowserContext | null = null;

  const proxy = new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);

      const ctx: Ctx = { page: proxy, target: proxy, sourceLocation: null, getTestName };

      if (LOCATOR_FACTORY_METHODS.has(prop)) {
        return (...args: any[]) => {
          const sourceLocation = captureCallSite();
          const result = (target as any)[prop](...args);
          return wrapLocator(result, { ...ctx, sourceLocation });
        };
      }

      if (prop === 'frameLocator') {
        return (...args: any[]) => {
          const rawFrame = target.frameLocator(...(args as [string]));
          return wrapFrameLocator(rawFrame, ctx);
        };
      }

      if (PAGE_STRING_ACTION_METHODS.has(prop)) {
        return async (...args: any[]) => {
          const [selector, ...rest] = args;
          const sourceLocation = captureCallSite();
          const originalLocator = target.locator(selector);
          const method = mapPageMethodToLocatorMethod(prop);

          const cacheProbe = await tryHealFromCache({
            page: proxy,
            target: proxy,
            originalLocator,
            method,
            args: rest,
            sourceLocation,
            testName: getTestName(),
          });
          if (cacheProbe.ok) return cacheProbe.result;

          try {
            return await (target as any)[prop](selector, ...rest);
          } catch (error) {
            return heal({
              page: proxy,
              target: proxy,
              originalLocator,
              method,
              args: rest,
              error,
              actionOptions: extractActionOptions(rest),
              sourceLocation,
              testName: getTestName(),
            });
          }
        };
      }

      if (prop === 'context') {
        return () => {
          if (!boundContext) {
            const rawContext = target.context();
            propagateTestName(target, rawContext);
            boundContext = bindContext(rawContext);
          }
          return boundContext;
        };
      }

      if (prop === 'on' || prop === 'once') {
        return (event: string, handler: any) => {
          const wrapped = event === 'popup' ? wrapPopupHandler(handler, target, wrapPage) : handler;
          return (target as any)[prop](event, wrapped);
        };
      }

      if (prop === 'waitForEvent') {
        return async (event: string, ...rest: any[]) => {
          const result = await (target as any).waitForEvent(event, ...rest);
          if (event === 'popup' && result) {
            propagateTestName(target, result);
            return wrapPage(result);
          }
          return result;
        };
      }

      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  knownProxies.add(proxy);
  pageProxies.set(raw, proxy);
  return proxy;
}

function mapPageMethodToLocatorMethod(pageMethod: string): string {
  // Page and Locator share the same method names for every action we intercept
  // at the page level today, so this is an identity mapping kept as a named
  // seam in case that ever needs to diverge.
  return pageMethod;
}

export function bindContext(raw: BrowserContext): BrowserContext {
  if (knownProxies.has(raw)) return raw;
  const existing = contextProxies.get(raw);
  if (existing) return existing;

  const proxy = new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);

      if (prop === 'newPage') {
        return async (...args: any[]) => {
          const newRawPage = await target.newPage(...(args as []));
          propagateTestName(target, newRawPage);
          return wrapPage(newRawPage);
        };
      }

      if (prop === 'pages') {
        return () =>
          target.pages().map((p) => {
            propagateTestName(target, p);
            return wrapPage(p);
          });
      }

      if (prop === 'on' || prop === 'once') {
        return (event: string, handler: any) => {
          const wrapped = event === 'page' || event === 'popup' ? wrapPopupHandler(handler, target, wrapPage) : handler;
          return (target as any)[prop](event, wrapped);
        };
      }

      if (prop === 'waitForEvent') {
        return async (event: string, ...rest: any[]) => {
          const result = await (target as any).waitForEvent(event, ...rest);
          if ((event === 'page' || event === 'popup') && result) {
            propagateTestName(target, result);
            return wrapPage(result);
          }
          return result;
        };
      }

      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  knownProxies.add(proxy);
  contextProxies.set(raw, proxy);
  return proxy;
}

/** Manual entry point for code not using the `test` fixture export. */
export function bind(page: Page): Page {
  return wrapPage(page);
}

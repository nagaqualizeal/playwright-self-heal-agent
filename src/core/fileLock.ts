import fs from 'fs';

// Playwright runs each worker as its own process, and every worker reads, modifies and rewrites
// the same report/cache JSON files. Without coordination two workers interleave: one reads while
// another is mid-write, sees a torn file, and its next write replaces everything the others
// recorded. These two primitives close both halves of that race:
//   - withFileLock serializes read-modify-write cycles across processes, using an exclusively
//     created lock file (`wx` fails if it already exists — an atomic test-and-set on every OS).
//   - writeFileAtomic writes to a temp file and renames it into place, so a reader that doesn't
//     take the lock (a cache probe, the `apply` CLI) always sees a complete old or new file.
//
// Every wait here is async on purpose. Playwright's driver runs inside the worker process, so a
// synchronous sleep would freeze it too, and the test's own action timeouts would keep ticking
// while it sat waiting for a lock.

// A lock is held for a few milliseconds (one small JSON read + write). One older than this belongs
// to a worker that crashed mid-write and is safe to break.
const STALE_LOCK_MS = 10_000;
const ACQUIRE_TIMEOUT_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withFileLock<T>(targetPath: string, fn: () => T | Promise<T>): Promise<T> {
  const lockPath = `${targetPath}.lock`;
  const startedAt = Date.now();
  let fd: number | null = null;

  while (fd === null) {
    try {
      fd = fs.openSync(lockPath, 'wx');
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;

      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        // The holder released it between our open and stat — just retry.
        continue;
      }

      if (Date.now() - startedAt > ACQUIRE_TIMEOUT_MS) {
        throw new Error(`QASH: timed out after ${ACQUIRE_TIMEOUT_MS}ms waiting for ${lockPath}`);
      }
      await sleep(5 + Math.random() * 20);
    }
  }

  try {
    return await fn();
  } finally {
    fs.closeSync(fd);
    fs.rmSync(lockPath, { force: true });
  }
}

// Windows refuses a rename onto a file another process has open at that instant (EPERM/EBUSY/
// EACCES) — e.g. a lock-free reader mid-readFileSync. Those clear within milliseconds, so retry.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);

export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, content);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmpPath, filePath);
      return;
    } catch (error: any) {
      if (!RENAME_RETRY_CODES.has(error?.code) || attempt >= 50) {
        fs.rmSync(tmpPath, { force: true });
        throw error;
      }
      await sleep(10);
    }
  }
}

// A file that still fails to parse wasn't torn by a concurrent write (writes are atomic now) — it
// was edited or damaged by hand. Set it aside rather than silently treating it as empty, which is
// what used to let one worker wipe every other worker's entries.
export function quarantineCorruptFile(filePath: string, error: unknown) {
  const asidePath = `${filePath}.corrupt-${Date.now()}`;
  try {
    fs.renameSync(filePath, asidePath);
    console.warn(`QASH: ${filePath} could not be parsed (${(error as Error)?.message}); moved it to ${asidePath} and started fresh.`);
  } catch {
    // Someone else already moved it.
  }
}

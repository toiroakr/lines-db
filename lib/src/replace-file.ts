import { randomBytes } from 'node:crypto';
import { chmod, link, readFile, rename, rm, stat } from 'node:fs/promises';
import type { JsonlConflictError } from './types.js';

export async function replaceFile(
  file: string,
  write: (temporary: string) => Promise<void>,
  expected: string | undefined,
): Promise<void> {
  const suffix = randomBytes(12).toString('hex');
  const temporary = `${file}.${suffix}.tmp`;
  const backup = `${file}.${suffix}.backup`;
  let moved = false;
  const conflict = () =>
    Object.assign(new Error(`JSONL file '${file}' changed during the write`), {
      name: 'JsonlConflictError',
      file,
    }) as JsonlConflictError;
  try {
    await write(temporary);
    const mode = await stat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (mode) await chmod(temporary, mode.mode & 0o7777);
    if (expected !== undefined) {
      await rename(file, backup).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') throw conflict();
        throw error;
      });
      moved = true;
      if ((await readFile(backup, 'utf8')) !== expected) throw conflict();
    }
    await link(temporary, file).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') throw conflict();
      throw error;
    });
    if (moved) {
      await rm(backup);
      moved = false;
    }
  } catch (error) {
    if (moved) {
      try {
        await link(backup, file);
        await rm(backup);
        moved = false;
      } catch (restoreError) {
        if (error instanceof Error) {
          error.message += `; original content remains in '${backup}' because it could not be restored`;
        } else {
          throw new Error(`Original content remains in '${backup}' because it could not be restored`, {
            cause: restoreError,
          });
        }
      }
    }
    throw error;
  } finally {
    await rm(temporary, { force: true });
  }
}

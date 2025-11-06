import { assertEquals, assert } from 'jsr:@std/assert';
// @deno-types="../../lib/dist/index.d.ts"
import { LinesDB, TypeGenerator, type DatabaseConfig } from '@toiroakr/lines-db';
import { runDatabaseTests, type TestRunner } from '../shared/test-suite.ts';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

async function createDb() {
  // Create temp directory
  const testDir = await Deno.makeTempDir({ prefix: 'lines-db-test-' });

  // Copy fixtures to temp directory
  const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../unit/fixtures');

  // Copy all files from fixtures directory
  for await (const entry of Deno.readDir(fixturesDir)) {
    if (entry.isFile) {
      const srcPath = join(fixturesDir, entry.name);
      const destPath = join(testDir, entry.name);
      await Deno.copyFile(srcPath, destPath);
    }
  }

  // Generate type definitions
  const generator = new TypeGenerator({ dataDir: testDir });
  await generator.generate();

  const config: DatabaseConfig = { dataDir: testDir };
  return LinesDB.create(config);
}

// Adapter for Deno test runner
const runner: TestRunner = {
  describe: (_name: string, fn: () => void) => {
    // Deno.test doesn't have describe, so we just run the tests
    fn();
  },
  it: (name: string, fn: () => void | Promise<void>) => {
    Deno.test(name, fn);
  },
  beforeEach: (_fn: () => void | Promise<void>) => {
    // Deno doesn't have built-in beforeEach
    // Each test will handle initialization
  },
  afterEach: (_fn: () => void | Promise<void>) => {
    // Deno doesn't have built-in afterEach
    // Each test will handle cleanup
  },
  expect: (actual: unknown) => ({
    toBe: (expected: unknown) => assertEquals(actual, expected),
    toEqual: (expected: unknown) => assertEquals(actual, expected),
    toBeTruthy: () => assert(actual),
    toBeFalsy: () => assert(!actual),
    toBeNull: () => assertEquals(actual, null),
    toBeGreaterThan: (expected: number) => assert((actual as number) > expected),
    toContain: (expected: unknown) => {
      if (Array.isArray(actual)) {
        assert(actual.includes(expected));
      } else {
        throw new Error('toContain can only be used with arrays');
      }
    },
    toHaveLength: (expected: number) => {
      assertEquals((actual as unknown[]).length, expected);
    },
  }),
};

runDatabaseTests(runner, createDb);

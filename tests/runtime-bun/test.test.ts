import { test, expect, beforeEach, afterEach, describe } from 'bun:test';
import { LinesDB, TypeGenerator, type DatabaseConfig } from 'lines-db';
import { runDatabaseTests, type TestRunner } from '../shared/test-suite.ts';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, cp } from 'node:fs/promises';

let testDir: string;
let config: DatabaseConfig;

// Setup: Copy fixtures to temp directory before running tests
beforeEach(async () => {
  const tmpBase = join(tmpdir(), 'lines-db-test-');
  testDir = await mkdtemp(tmpBase);

  // Copy fixtures to temp directory
  const fixturesDir = join(import.meta.dir, '../unit/fixtures');
  await cp(fixturesDir, testDir, { recursive: true });

  // Generate type definitions
  const generator = new TypeGenerator({ dataDir: testDir });
  await generator.generate();

  config = {
    dataDir: testDir,
  };
});

// Cleanup: Remove temp directory after tests
afterEach(async () => {
  if (testDir) {
    await rm(testDir, { recursive: true, force: true });
  }
});

function createDb() {
  return LinesDB.create(config);
}

// Adapter for Bun test runner
const runner: TestRunner = {
  describe,
  it: test,
  beforeEach,
  afterEach,
  expect: (actual: unknown) => ({
    toBe: (expected: unknown) => expect(actual).toBe(expected),
    toEqual: (expected: unknown) => expect(actual).toEqual(expected),
    toBeTruthy: () => expect(actual).toBeTruthy(),
    toBeFalsy: () => expect(actual).toBeFalsy(),
    toBeNull: () => expect(actual).toBeNull(),
    toBeGreaterThan: (expected: number) => expect(actual as number).toBeGreaterThan(expected),
    toContain: (expected: unknown) => {
      if (Array.isArray(actual)) {
        expect(actual).toContain(expected);
      } else {
        throw new Error('toContain can only be used with arrays');
      }
    },
    toHaveLength: (expected: number) => {
      expect(actual as unknown[]).toHaveLength(expected);
    },
  }),
};

runDatabaseTests(runner, createDb);

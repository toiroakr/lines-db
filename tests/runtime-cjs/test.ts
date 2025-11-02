import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, cp } from 'node:fs/promises';
const { LinesDB } = require('lines-db');
const { runDatabaseTests } = require('../shared/test-suite.js');
const { TypeGenerator } = require('lines-db');

let testDir: string;
let config: any;

// Setup: Copy fixtures to temp directory before running tests
beforeEach(async () => {
  const tmpBase = join(tmpdir(), 'lines-db-test-');
  testDir = await mkdtemp(tmpBase);

  // Copy fixtures to temp directory
  const fixturesDir = join(__dirname, '../unit/fixtures');
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

// Adapter for Node.js test runner
const runner = {
  describe,
  it,
  beforeEach,
  afterEach,
  expect: (actual: any) => ({
    toBe: (expected: any) => assert.strictEqual(actual, expected),
    toEqual: (expected: any) => assert.deepStrictEqual(actual, expected),
    toBeTruthy: () => assert.ok(actual),
    toBeFalsy: () => assert.ok(!actual),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeGreaterThan: (expected: number) => assert.ok(actual > expected),
    toContain: (expected: any) => {
      if (Array.isArray(actual)) {
        assert.ok(actual.includes(expected));
      } else {
        throw new Error('toContain can only be used with arrays');
      }
    },
    toHaveLength: (expected: number) => {
      assert.strictEqual(actual.length, expected);
    },
  }),
};

runDatabaseTests(runner, createDb);

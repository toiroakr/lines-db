/**
 * Runtime detection utilities
 */

export type RuntimeEnvironment = 'node' | 'bun' | 'deno' | 'unknown';

export function detectRuntime(): RuntimeEnvironment {
  // Check for Bun
  if (
    typeof globalThis !== 'undefined' &&
    'Bun' in globalThis &&
    typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
  ) {
    return 'bun';
  }

  // Check for Deno
  if (
    typeof globalThis !== 'undefined' &&
    'Deno' in globalThis &&
    typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined'
  ) {
    return 'deno';
  }

  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }

  return 'unknown';
}

export const RUNTIME = detectRuntime();

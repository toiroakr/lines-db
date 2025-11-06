/**
 * Runtime detection utilities
 */

export type RuntimeEnvironment = 'node' | 'unknown';

export function detectRuntime(): RuntimeEnvironment {
  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return 'node';
  }

  return 'unknown';
}

export const RUNTIME = detectRuntime();

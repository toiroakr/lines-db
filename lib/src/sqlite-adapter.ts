/**
 * SQLite adapter that works across Node.js, Bun, and Deno
 */

import { RUNTIME } from './runtime.js';

/**
 * Common interface for SQLite database
 */
export interface SQLiteDatabase {
  prepare(sql: string): SQLiteStatement;
  exec(sql: string): void;
  close(): void;
}

export interface SQLiteStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: any[]): any;
  all(...params: any[]): any[];
}

/**
 * Create a SQLite database instance based on the runtime environment
 */
export function createDatabase(path: string = ':memory:'): SQLiteDatabase {
  if (RUNTIME === 'bun') {
    return createBunDatabase(path);
  } else if (RUNTIME === 'node' || RUNTIME === 'deno') {
    return createNodeDatabase(path);
  } else {
    throw new Error(`Unsupported runtime: ${RUNTIME}`);
  }
}

/**
 * Create a Bun SQLite database
 */
function createBunDatabase(path: string): SQLiteDatabase {
  // Dynamic import for Bun
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Database } = require('bun:sqlite');
  const db = new Database(path);

  return {
    prepare(sql: string): SQLiteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: any[]) {
          return stmt.run(...params);
        },
        get(...params: any[]) {
          return stmt.get(...params);
        },
        all(...params: any[]) {
          return stmt.all(...params);
        },
      };
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    close(): void {
      db.close();
    },
  };
}

/**
 * Create a Node.js SQLite database
 */
function createNodeDatabase(path: string): SQLiteDatabase {
  // Dynamic import for Node.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path);

  return {
    prepare(sql: string): SQLiteStatement {
      const stmt = db.prepare(sql);
      return {
        run(...params: any[]) {
          return stmt.run(...params);
        },
        get(...params: any[]) {
          return stmt.get(...params);
        },
        all(...params: any[]) {
          return stmt.all(...params);
        },
      };
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    close(): void {
      db.close();
    },
  };
}

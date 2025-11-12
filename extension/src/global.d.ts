import * as vscode from 'vscode';
import type { TempFileManager } from './tempFileManager';

declare global {
  var __linesDbOutputChannel: vscode.OutputChannel;

  var __tempFileManager: TempFileManager | undefined;

  var __linesDbModule:
    | {
        Validator: new (options: { path: string }) => {
          validate: () => Promise<{
            valid: boolean;
            errors: Array<{
              file: string;
              tableName: string;
              rowIndex: number;
              type?: string;
              issues: Array<{ message: string; path?: unknown[] }>;
              foreignKeyError?: {
                column: string;
                value: unknown;
                referencedTable: string;
                referencedColumn: string;
              };
            }>;
          }>;
        };
        LinesDB: {
          create: (config: { dataDir: string }) => {
            initialize: (options: { tableName: string; detailedValidate?: boolean }) => Promise<{
              valid: boolean;
              errors: Array<{
                file: string;
                tableName: string;
                rowIndex: number;
                type?: string;
                issues: Array<{ message: string; path?: unknown[] }>;
                foreignKeyError?: {
                  column: string;
                  value: unknown;
                  referencedTable: string;
                  referencedColumn: string;
                };
              }>;
            }>;
            close: () => Promise<void>;
          };
        };
        JsonlReader: {
          read: (path: string) => Promise<unknown[]>;
          withOverrides: <T>(
            overrides: Map<string, unknown[]>,
            callback: () => Promise<T>,
          ) => Promise<T>;
        };
        SchemaLoader: {
          hasSchema: (jsonlPath: string) => Promise<boolean>;
          loadSchema: (jsonlPath: string) => Promise<unknown>;
        };
        ensureTableRowsValid: (options: {
          dataDir: string;
          tableName: string;
          rows: unknown[];
        }) => Promise<void>;
      }
    | undefined;
}

export {};

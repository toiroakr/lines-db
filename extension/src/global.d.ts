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
        JsonlReader: {
          read: (path: string) => Promise<unknown[]>;
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

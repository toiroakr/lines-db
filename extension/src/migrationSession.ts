import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { JsonlReader } from '../../lib/dist/index.cjs';

export interface MigrationSessionInfo {
  migrationFilePath: string;
  originalFilePath: string;
  tableName: string;
  dataDir: string;
  previewFilePath?: string;
}

export class MigrationSessionManager {
  private static sessions = new Map<string, MigrationSessionInfo>();
  private static diagnosticCollection: vscode.DiagnosticCollection;
  private static watcher?: vscode.FileSystemWatcher;

  static initialize(context: vscode.ExtensionContext) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('lines-db-migration');
    context.subscriptions.push(this.diagnosticCollection);
  }

  static async createSession(
    originalFilePath: string,
    tableName: string,
    dataDir: string,
  ): Promise<string> {
    // Create temporary migration file
    const migrationFileName = `${tableName}.migration.ts`;
    const migrationFilePath = path.join(os.tmpdir(), migrationFileName);

    // Generate TypeScript migration template
    const template = await this.generateMigrationTemplate(originalFilePath, tableName);
    fs.writeFileSync(migrationFilePath, template, 'utf-8');

    // Store session info
    const sessionInfo: MigrationSessionInfo = {
      migrationFilePath,
      originalFilePath,
      tableName,
      dataDir,
    };
    this.sessions.set(migrationFilePath, sessionInfo);

    return migrationFilePath;
  }

  static getSession(migrationFilePath: string): MigrationSessionInfo | undefined {
    return this.sessions.get(migrationFilePath);
  }

  static closeSession(migrationFilePath: string) {
    const session = this.sessions.get(migrationFilePath);
    if (session) {
      // Clean up temporary files
      if (fs.existsSync(migrationFilePath)) {
        fs.unlinkSync(migrationFilePath);
      }
      if (session.previewFilePath && fs.existsSync(session.previewFilePath)) {
        fs.unlinkSync(session.previewFilePath);
      }
      this.sessions.delete(migrationFilePath);
    }
  }

  static async generateMigrationTemplate(
    originalFilePath: string,
    tableName: string,
  ): Promise<string> {
    // Load sample data and schema information
    let sampleDataComment = '';
    let typeDefinition = '';
    let mapDefinition = '';

    try {
      // Read JSONL data directly so we can proceed even when validation fails
      const rows = await JsonlReader.read(originalFilePath);

      if (rows.length > 0) {
        const sample = rows[0];
        const fields = Object.keys(sample)
          .map((key) => `  ${key}: ${JSON.stringify(sample[key])}`)
          .join(',\n');
        sampleDataComment = `/**
 * Sample row structure:
 * {
${fields}
 * }
 */\n`;

        // Generate TypeScript type from sample data
        const typeFields = Object.entries(sample)
          .map(([key, value]) => {
            let typeStr: string;
            if (value === null) {
              typeStr = 'any';
            } else if (Array.isArray(value)) {
              typeStr = 'any[]';
            } else {
              typeStr = typeof value;
            }
            return `  ${key}: ${typeStr};`;
          })
          .join('\n');
        mapDefinition = Object.keys(sample)
          .map((key) => `    ${key}: row.${key}`)
          .join(',\n');

        typeDefinition = `type Row = {\n${typeFields}\n};\n\n`;
      } else {
        typeDefinition = `type Row = any;\n\n`;
      }
    } catch {
      // If loading fails, use generic type
      typeDefinition = `type Row = any;\n\n`;
    }

    return /* js */ `/**
 * Migration for ${tableName}
 *
 * This file will be validated on save:
 * - Transformation is applied in a transaction
 * - All constraints are checked (foreign keys, unique, etc.)
 */
export const migration: Migration = {
  filter: (row) => true,
  transform: (row) => ({\n${mapDefinition}\n  }),
};

/**
 * @param filter Function to filter rows to migrate
 * @param transform Function to transform each row
 */
type Migration = {
  filter: (row: Row) => boolean;
  transform: (row: Row) => Row;
};

${sampleDataComment}${typeDefinition}
`;
  }

  static setDiagnostics(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]) {
    this.diagnosticCollection.set(uri, diagnostics);
  }

  static clearDiagnostics(uri: vscode.Uri) {
    this.diagnosticCollection.delete(uri);
  }

  static updatePreviewPath(migrationFilePath: string, previewFilePath: string) {
    const session = this.sessions.get(migrationFilePath);
    if (session) {
      session.previewFilePath = previewFilePath;
    }
  }

  static getAllSessions(): Map<string, MigrationSessionInfo> {
    return this.sessions;
  }
}

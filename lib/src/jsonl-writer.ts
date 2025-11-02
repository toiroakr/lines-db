import { writeFile } from 'node:fs/promises';
import type { JsonObject } from './types.js';

export class JsonlWriter {
  /**
   * Write data to JSONL file
   */
  static async write(filePath: string, data: JsonObject[]): Promise<void> {
    const lines = data.map((obj) => JSON.stringify(obj)).join('\n');
    await writeFile(filePath, lines + '\n', 'utf-8');
  }

  /**
   * Append data to JSONL file
   */
  static async append(filePath: string, data: JsonObject[]): Promise<void> {
    const { readFile, writeFile } = await import('node:fs/promises');

    try {
      const existing = await readFile(filePath, 'utf-8');
      const lines = data.map((obj) => JSON.stringify(obj)).join('\n');
      const newContent = existing.trim() + '\n' + lines + '\n';
      await writeFile(filePath, newContent, 'utf-8');
    } catch (error) {
      // If file doesn't exist, just write the data
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await this.write(filePath, data);
      } else {
        throw error;
      }
    }
  }
}

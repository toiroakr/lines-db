import type { JsonObject } from '../types.js';

/**
 * The content with the rows at the given indexes - counting the lines that hold a row, as reading
 * the file does - written over their lines, and every other line left as it was
 */
export function replaceRows(content: string, replaced: ReadonlyMap<number, JsonObject>): string {
  const bom = content.startsWith('\u{feff}') ? '\u{feff}' : '';
  let index = -1;
  const lines = content
    .slice(bom.length)
    .split('\n')
    .map((raw) => {
      const carriage = raw.endsWith('\r') ? '\r' : '';
      if (raw.trim() === '') return raw;
      index += 1;
      const row = replaced.get(index);
      return row ? `${JSON.stringify(row)}${carriage}` : raw;
    });
  return bom + lines.join('\n');
}

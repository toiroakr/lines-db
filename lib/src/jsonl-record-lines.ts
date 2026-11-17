export interface JsonlRecordLine {
  /** The row's text, trimmed */
  text: string;
  /** 1-based physical line */
  line: number;
  /** Set when characters JSON does not allow as whitespace were trimmed from around the row */
  warning?: string;
}

function strayWhitespace(raw: string, trimmed: string): string[] {
  const start = raw.indexOf(trimmed);
  const around = raw.slice(0, start) + raw.slice(start + trimmed.length);
  return [...new Set(around)].filter((char) => char !== ' ' && char !== '\t' && char !== '\r');
}

/**
 * Split JSONL content into the lines that hold a row: one leading byte order mark and each line's
 * trailing carriage return are dropped, and lines that are blank after trimming are skipped.
 * `line` is the 1-based physical line, so skipped lines still count. Whitespace around a row is
 * trimmed; a character JSON does not allow as whitespace, such as a non-breaking space, is
 * trimmed with a `warning`.
 */
export function jsonlRecordLines(content: string): JsonlRecordLine[] {
  const lines = (content.startsWith('\u{feff}') ? content.slice(1) : content).split('\n');
  return lines.flatMap((raw, index) => {
    const text = raw.trim();
    if (text.length === 0) return [];
    const stray = strayWhitespace(raw, text);
    const record: JsonlRecordLine = { text, line: index + 1 };
    if (stray.length > 0) {
      const codePoints = stray.map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`);
      record.warning = `has ${codePoints.join(', ')} around its row, which JSON does not allow`;
    }
    return [record];
  });
}

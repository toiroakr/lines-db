const CLOSER: Record<string, string> = { "'": "'", '"': '"', '`': '`', '[': ']' };

/**
 * Split SQL text into its statements at `;`, the way SQLite reads it: a `;` inside a comment or quoted
 * text does not end a statement, and a comment is left out as the whitespace it is
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  while (i < sql.length) {
    const char = sql[i]!;
    if (char === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      current += ' ';
    } else if (char === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      current += ' ';
    } else if (char in CLOSER) {
      // A doubled quote inside is read as a closing one followed by an opening one, which copies the same
      const end = sql.indexOf(CLOSER[char]!, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(i, stop);
      i = stop;
    } else if (char === ';') {
      statements.push(current);
      current = '';
      i += 1;
    } else {
      current += char;
      i += 1;
    }
  }
  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => statement.length > 0);
}

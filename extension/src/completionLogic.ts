import { hasQuoteBefore, hasQuoteAfter, generateFieldNameInsertText } from './quoteHelper.js';

/**
 * Field information for completion
 */
export interface FieldInfo {
  name: string;
  type: string;
}

/**
 * Completion item result
 */
export interface CompletionResult {
  label: string;
  insertText: string;
  range?: { start: number; end: number };
  filterText?: string;
}

/**
 * Context for field name completion
 */
export interface FieldNameCompletionContext {
  textBeforeCursor: string;
  textAfterCursor: string;
  cursor: number;
  fields: FieldInfo[];
  existingFields: Set<string>;
}

/**
 * Context for value completion
 */
export interface ValueCompletionContext {
  textBeforeCursor: string;
  textAfterCursor: string;
  cursor: number;
  fieldName: string;
  fkValues?: string[];
}

/**
 * Remove quoted strings from text (for structural analysis)
 */
export function removeQuotedStrings(text: string): string {
  return text.replace(/"(?:\\.|[^"\\])*"/g, '""');
}

/**
 * Check if cursor is in a position to complete a field name
 */
export function isInFieldNamePosition(textBeforeCursor: string): boolean {
  const withoutStrings = removeQuotedStrings(textBeforeCursor);
  const lastBrace = withoutStrings.lastIndexOf('{');
  if (lastBrace === -1) return false;

  const afterBrace = withoutStrings.substring(lastBrace);
  const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
  const insideQuotes = quoteCount % 2 === 1;

  const colonIndex = afterBrace.lastIndexOf(':');
  const commaIndex = afterBrace.lastIndexOf(',');

  if (colonIndex !== -1 && insideQuotes) {
    if (commaIndex > colonIndex) {
      return true;
    }
    const afterColon = afterBrace.substring(colonIndex + 1).trim();
    if (afterColon.length === 0 || afterColon === '"') {
      return false;
    }
  }

  return (
    insideQuotes ||
    afterBrace.endsWith(',') ||
    afterBrace.endsWith('{') ||
    /[,{]\s*$/.test(afterBrace)
  );
}

/**
 * Extract existing fields in the current object
 */
export function extractExistingFields(textBeforeCursor: string): Set<string> {
  const fields = new Set<string>();
  const lastBrace = textBeforeCursor.lastIndexOf('{');
  if (lastBrace === -1) return fields;

  const objectText = textBeforeCursor.substring(lastBrace);
  const fieldPattern = /"([^"]+)"\s*:/g;
  let match;
  while ((match = fieldPattern.exec(objectText)) !== null) {
    fields.add(match[1]);
  }
  return fields;
}

/**
 * Find the current field name being assigned (for value completion)
 */
export function findCurrentFieldName(textBeforeCursor: string): string | undefined {
  const match = textBeforeCursor.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);
  return match ? match[1] : undefined;
}

/**
 * Extract partial field name typed after opening quote
 */
export function extractPartialFieldName(textBeforeCursor: string): string {
  const lastQuoteIndex = textBeforeCursor.lastIndexOf('"');
  if (lastQuoteIndex === -1) return '';
  return textBeforeCursor.substring(lastQuoteIndex + 1);
}

/**
 * Extract partial value input
 */
export function extractPartialValue(textBeforeCursor: string): string {
  const colonIndex = textBeforeCursor.lastIndexOf(':');
  if (colonIndex === -1) return '';

  const afterColon = textBeforeCursor.substring(colonIndex + 1);
  const quoteIndex = afterColon.indexOf('"');
  if (quoteIndex === -1) return '';

  return afterColon.substring(quoteIndex + 1);
}

/**
 * Check if cursor is inside a value (not field name)
 */
export function isInsideValue(textBeforeCursor: string, textAfterCursor: string): boolean {
  const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
  const insideQuotes = quoteCount % 2 === 1;

  if (!insideQuotes) return false;

  const lastQuoteIndex = textBeforeCursor.lastIndexOf('"');
  if (lastQuoteIndex === -1) return false;

  const beforeLastQuote = textBeforeCursor.substring(0, lastQuoteIndex);
  return /"[^"]+"\s*:\s*$/.test(beforeLastQuote);
}

/**
 * Get field name completions
 */
export function getFieldNameCompletions(ctx: FieldNameCompletionContext): CompletionResult[] {
  const { textBeforeCursor, textAfterCursor, cursor, fields, existingFields } = ctx;

  const quoteBefore = hasQuoteBefore(textBeforeCursor);
  const quoteAfter = hasQuoteAfter(textAfterCursor);

  // Check if this is an edit scenario (cursor in middle of existing field name)
  const isEditingFieldName = quoteBefore && /^[a-zA-Z_][a-zA-Z0-9_]*"\s*:/.test(textAfterCursor);

  // Extract partial input for filtering
  const partialInputBefore = quoteBefore ? extractPartialFieldName(textBeforeCursor) : '';

  // For edit scenarios, also consider text after cursor
  let partialInput = partialInputBefore;
  if (isEditingFieldName) {
    const match = textAfterCursor.match(/^([a-zA-Z_][a-zA-Z0-9_]*)"/);
    if (match) {
      partialInput = partialInputBefore + match[1];
    }
  }

  // Filter fields
  let filteredFields = fields.filter((f) => !existingFields.has(f.name));
  if (partialInput) {
    filteredFields = filteredFields.filter((f) =>
      f.name.toLowerCase().startsWith(partialInput.toLowerCase()),
    );
  }

  if (filteredFields.length === 0) {
    return [];
  }

  return filteredFields.map((field) => {
    let insertText: string;
    let range: { start: number; end: number } | undefined;
    let filterText: string | undefined;

    if (isEditingFieldName) {
      // Edit scenario: replace field name and include existing value as placeholder
      const lastQuoteIndex = textBeforeCursor.lastIndexOf('"');

      const colonMatch = textAfterCursor.match(/^[a-zA-Z_][a-zA-Z0-9_]*"\s*:\s*"([^"]*)"/);
      if (colonMatch) {
        const fullMatch = colonMatch[0];
        const existingValue = colonMatch[1];
        range = { start: lastQuoteIndex, end: cursor + fullMatch.length };
        insertText = `"${field.name}": "\${1:${existingValue}}"`;
      } else {
        const closingQuoteIndex = textAfterCursor.indexOf('"');
        range = { start: lastQuoteIndex, end: cursor + closingQuoteIndex + 1 };
        insertText = `"${field.name}": "\${1}"`;
      }
      // Include the opening quote in filterText to match VSCode's word boundary
      filterText = `"${partialInputBefore}`;
    } else if (quoteBefore && quoteAfter) {
      // Case: "|"} or similar
      const lastQuoteIndex = textBeforeCursor.lastIndexOf('"');

      const emptyFieldMatch = textAfterCursor.match(/^"\}"?/);
      let endOffset: number;
      if (emptyFieldMatch) {
        endOffset = emptyFieldMatch[0].length;
      } else {
        const nextQuoteIndex = textAfterCursor.indexOf('"');
        endOffset = nextQuoteIndex + 1;
      }

      range = { start: lastQuoteIndex, end: cursor + endOffset };
      insertText = `"${field.name}": "\${1}"`;
      filterText = partialInputBefore || field.name;
    } else if (quoteBefore && !quoteAfter) {
      // Case: {"na| or {"|}
      const lastQuoteIndex = textBeforeCursor.lastIndexOf('"');

      const emptyFieldBraceMatch = textAfterCursor.match(/^\}"\}/);
      let endOffset: number;
      if (emptyFieldBraceMatch) {
        endOffset = 2;
      } else {
        endOffset = 0;
      }

      range = { start: lastQuoteIndex, end: cursor + endOffset };
      insertText = `"${field.name}": "\${1}"`;
      filterText = partialInputBefore || field.name;
    } else {
      // No quotes - use default insertText
      insertText = generateFieldNameInsertText(field.name, field.type, quoteBefore);
    }

    return { label: field.name, insertText, range, filterText };
  });
}

/**
 * Get value completions (for FK values)
 */
export function getValueCompletions(ctx: ValueCompletionContext): CompletionResult[] {
  const { textBeforeCursor, textAfterCursor, cursor, fieldName, fkValues } = ctx;

  if (!fkValues || fkValues.length === 0) {
    return [];
  }

  // Check if cursor is inside quotes
  const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
  const insideQuotes = quoteCount % 2 === 1;

  if (!insideQuotes) {
    // Not inside quotes - return values with quotes
    return fkValues.map((value) => ({
      label: value,
      insertText: `"${value}"`,
    }));
  }

  // Inside quotes
  const partialValue = extractPartialValue(textBeforeCursor);
  const lastQuoteIndex = textBeforeCursor.lastIndexOf('"');
  const nextQuoteIndex = textAfterCursor.indexOf('"');
  const hasClosingQuote = nextQuoteIndex !== -1;

  const valueStartPos = lastQuoteIndex + 1;
  const valueEndPos = hasClosingQuote ? cursor + nextQuoteIndex : cursor;

  // Filter values based on partial input
  const filteredValues = fkValues.filter((v) =>
    v.toLowerCase().startsWith(partialValue.toLowerCase()),
  );

  return filteredValues.map((value) => ({
    label: value,
    insertText: hasClosingQuote ? value : value + '"',
    range: { start: valueStartPos, end: valueEndPos },
  }));
}

/**
 * Main completion function that combines field name and value completion
 */
export function getCompletions(
  text: string,
  cursor: number,
  fields: FieldInfo[],
  fkValues?: Map<string, string[]>,
): CompletionResult[] {
  const textBeforeCursor = text.substring(0, cursor);
  const textAfterCursor = text.substring(cursor);

  // Check if inside object
  if (!textBeforeCursor.includes('{')) {
    return [];
  }

  // First check if we're inside a value
  if (isInsideValue(textBeforeCursor, textAfterCursor)) {
    const fieldName = findCurrentFieldName(textBeforeCursor);
    if (!fieldName) {
      return [];
    }

    const fieldFkValues = fkValues?.get(fieldName);
    if (!fieldFkValues) {
      return [];
    }

    return getValueCompletions({
      textBeforeCursor,
      textAfterCursor,
      cursor,
      fieldName,
      fkValues: fieldFkValues,
    });
  }

  // Check if in field name position
  const isFieldName = isInFieldNamePosition(textBeforeCursor);
  if (!isFieldName) {
    // Value position (after colon, not inside quotes)
    const fieldName = findCurrentFieldName(textBeforeCursor);
    if (!fieldName) {
      return [];
    }

    const fieldFkValues = fkValues?.get(fieldName);
    if (!fieldFkValues) {
      return [];
    }

    return getValueCompletions({
      textBeforeCursor,
      textAfterCursor,
      cursor,
      fieldName,
      fkValues: fieldFkValues,
    });
  }

  // Check if cursor is between { or , and an existing field name quote
  // e.g., {|"name" or ,|"name" - should not complete in these cases
  const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
  const insideQuotes = quoteCount % 2 === 1;
  if (!insideQuotes && /^"[^"]+"\s*:/.test(textAfterCursor)) {
    return [];
  }

  // Field name completion
  const existingFields = extractExistingFields(textBeforeCursor);
  return getFieldNameCompletions({
    textBeforeCursor,
    textAfterCursor,
    cursor,
    fields,
    existingFields,
  });
}

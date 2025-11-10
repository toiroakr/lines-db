/**
 * Helper functions for handling quotes in completion items
 */

/**
 * Check if there's an unclosed quote before the cursor in field name context
 * This checks if we're typing inside a field name that was started with a quote
 */
export function hasQuoteBefore(textBeforeCursor: string): boolean {
  // Find the last structural separator (comma or opening brace)
  const lastComma = textBeforeCursor.lastIndexOf(',');
  const lastBrace = textBeforeCursor.lastIndexOf('{');
  const lastSeparator = Math.max(lastComma, lastBrace);

  // Get text after the last separator
  const textAfterSeparator =
    lastSeparator === -1 ? textBeforeCursor : textBeforeCursor.substring(lastSeparator + 1);

  // Count quotes in this section
  // Remove escaped quotes first
  const withoutEscapedQuotes = textAfterSeparator.replace(/\\"/g, '');
  const quoteCount = (withoutEscapedQuotes.match(/"/g) || []).length;

  // Odd number of quotes means we're inside a quoted field name
  return quoteCount % 2 === 1;
}

/**
 * Check if there's a quote immediately after the cursor
 */
export function hasQuoteAfter(textAfterCursor: string): boolean {
  return textAfterCursor.trimStart().startsWith('"');
}

/**
 * Generate insert text for field name completion
 */
export function generateFieldNameInsertText(
  fieldName: string,
  fieldType: string,
  quoteBefore: boolean,
): string {
  let insertText = '';

  // Add opening quote if needed
  if (!quoteBefore) {
    insertText += '"';
  }

  insertText += fieldName;

  // Always add closing quote for field name
  // If there's a quote after cursor, it will be deleted by item.range
  insertText += '"';

  // Add colon and value placeholder
  insertText += ': ';

  // Add value based on type
  if (fieldType === 'string' || fieldType === 'enum' || fieldType === 'literal') {
    insertText += '"${1}"';
  } else if (fieldType === 'number' || fieldType === 'boolean') {
    insertText += '${1}';
  } else if (fieldType === 'object') {
    insertText += '{${1}}';
  } else if (fieldType === 'array') {
    insertText += '[${1}]';
  }

  return insertText;
}

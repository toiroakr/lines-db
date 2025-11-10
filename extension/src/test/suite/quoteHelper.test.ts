import * as assert from 'assert';
import { suite, test } from 'mocha';
import { generateFieldNameInsertText, hasQuoteBefore, hasQuoteAfter } from '../../quoteHelper';

suite('Quote Helper', () => {
  suite('hasQuoteBefore', () => {
    test('should return true when text ends with quote', () => {
      assert.strictEqual(hasQuoteBefore('{"id":1, "'), true);
    });

    test('should return true when text ends with quote after spaces', () => {
      assert.strictEqual(hasQuoteBefore('{"id":1, "   '), true);
    });

    test('should return false when text does not end with quote', () => {
      assert.strictEqual(hasQuoteBefore('{"id":1, '), false);
    });
  });

  suite('hasQuoteAfter', () => {
    test('should return true when text starts with quote', () => {
      assert.strictEqual(hasQuoteAfter('"'), true);
    });

    test('should return true when text starts with quote after spaces', () => {
      assert.strictEqual(hasQuoteAfter('   "'), true);
    });

    test('should return false when text does not start with quote', () => {
      assert.strictEqual(hasQuoteAfter(''), false);
    });
  });

  suite('generateFieldNameInsertText', () => {
    test('Case 1: No quotes before or after cursor: {, |', () => {
      // Input: {"id":1,"name":"Alice", |
      // Expected: "gender": "${1}"
      const result = generateFieldNameInsertText('gender', 'enum', false);

      assert.strictEqual(result, '"gender": "${1}"', 'Should add both opening and closing quotes');
    });

    test('Case 2: Opening quote before cursor: {, "|', () => {
      // Input: {"id":1,"name":"Alice", "|
      // Expected: gender": "${1}"
      const result = generateFieldNameInsertText('gender', 'enum', true);

      // Should NOT start with quote (already present)
      assert.ok(
        !result.startsWith('"'),
        `Should NOT add opening quote when already present, got: ${result}`,
      );

      // Should be: gender": "${1}"
      assert.strictEqual(result, 'gender": "${1}"', 'Should only add closing quote and value');
    });

    test('Case 3: Number field without quotes', () => {
      const result = generateFieldNameInsertText('age', 'number', false);
      assert.strictEqual(
        result,
        '"age": ${1}',
        'Number field should not quote the value placeholder',
      );
    });

    test('Case 4: Object field without quotes', () => {
      const result = generateFieldNameInsertText('address', 'object', false);
      assert.strictEqual(
        result,
        '"address": {${1}}',
        'Object field should use braces for value placeholder',
      );
    });

    test('Case 5: Array field without quotes', () => {
      const result = generateFieldNameInsertText('tags', 'array', false);
      assert.strictEqual(
        result,
        '"tags": [${1}]',
        'Array field should use brackets for value placeholder',
      );
    });

    test('Case 6: Quote count when opening quote exists', () => {
      // Input: {"id":1,"name":"Alice", "|
      // Expected: gender": "${1}"
      const result = generateFieldNameInsertText('gender', 'string', true);

      // Count quotes: should have 1 for closing field name + 2 for value = 3 total
      const quoteCount = (result.match(/"/g) || []).length;
      assert.strictEqual(
        quoteCount,
        3,
        `Should have exactly 3 quotes (1 for closing field name, 2 for value), got ${quoteCount}: ${result}`,
      );
    });

    test('Case 7: Both opening and closing quotes exist: {, "|"', () => {
      // This is the problematic case reported by the user
      // Input: {"id":1,"name":"Alice", "|"}
      // The cursor is between two quotes: " | "
      // Expected insert text: gender": "${1}"
      // The closing quote after cursor will be deleted by item.range
      const result = generateFieldNameInsertText('gender', 'enum', true);

      // Should NOT start with quote (already present before cursor)
      assert.ok(
        !result.startsWith('"'),
        `Should NOT add opening quote when already present, got: ${result}`,
      );

      // Should NOT end with quote before colon (will be handled by item.range deletion)
      // Expected format: gender": "${1}"
      assert.strictEqual(
        result,
        'gender": "${1}"',
        'Should only add closing quote for field name and value, relying on item.range to delete existing closing quote',
      );

      // Count quotes: should have 1 for closing field name + 2 for value = 3 total
      const quoteCount = (result.match(/"/g) || []).length;
      assert.strictEqual(
        quoteCount,
        3,
        `Should have exactly 3 quotes (1 for closing field name, 2 for value), got ${quoteCount}: ${result}`,
      );
    });

    test('Case 8: Partial field name with opening quote: {, "gende|', () => {
      // User reported issue:
      // Input: {"id":1, "gende|}
      // When completing, VSCode replaces "gende" (the word under cursor)
      // But leaves the opening quote, resulting in: ""gender"
      // To fix this, we need item.range to include the opening quote

      // The insert text generation should be the same as Case 2
      const result = generateFieldNameInsertText('gender', 'enum', true);

      // Expected: gender": "${1}"
      assert.strictEqual(
        result,
        'gender": "${1}"',
        'Insert text should not include opening quote when already present',
      );
    });
  });
});

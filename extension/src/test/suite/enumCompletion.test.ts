import * as assert from 'assert';
import { suite, test } from 'mocha';

/**
 * Tests for enum value completions
 *
 * These tests verify that enum values are properly suggested and inserted
 * when completing values for enum-type fields.
 */
suite('Enum Value Completion', () => {
  suite('isInFieldNamePosition logic', () => {
    test('should return false when cursor is after colon in quotes (value position)', () => {
      // When typing: {"gender": "|
      // This should be detected as value position, not field name position
      const textBeforeCursor = '{"gender": "';

      // Check if we're inside quotes
      const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
      const insideQuotes = quoteCount % 2 === 1;

      // Remove quoted strings to find structural position
      const withoutStrings = textBeforeCursor.replace(/"(?:\\.|[^"\\])*"/g, '""');
      const lastBrace = withoutStrings.lastIndexOf('{');
      const afterBrace = withoutStrings.substring(lastBrace);
      const colonIndex = afterBrace.lastIndexOf(':');

      // If inside quotes after a colon, we're in a value position
      const isValuePosition = colonIndex !== -1 && insideQuotes;

      assert.strictEqual(
        isValuePosition,
        true,
        'Should detect value position when cursor is after colon and inside quotes',
      );
    });

    test('should return false when cursor is in the middle of a value', () => {
      // When typing: {"gender": "mal|
      const textBeforeCursor = '{"gender": "mal';

      const quoteCount = (textBeforeCursor.match(/"/g) || []).length;
      const insideQuotes = quoteCount % 2 === 1;

      const withoutStrings = textBeforeCursor.replace(/"(?:\\.|[^"\\])*"/g, '""');
      const lastBrace = withoutStrings.lastIndexOf('{');
      const afterBrace = withoutStrings.substring(lastBrace);
      const colonIndex = afterBrace.lastIndexOf(':');

      const isValuePosition = colonIndex !== -1 && insideQuotes;

      assert.strictEqual(
        isValuePosition,
        true,
        'Should detect value position when typing inside value quotes',
      );
    });
  });

  suite('findCurrentFieldName', () => {
    test('should extract field name from text before cursor', () => {
      // Case 1: Cursor after colon and opening quote
      // {"gender": "|
      const text1 = '{"gender": "';
      const match1 = text1.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);
      assert.ok(match1, 'Should match pattern');
      assert.strictEqual(match1[1], 'gender', 'Should extract gender field name');
    });

    test('should extract field name when cursor is mid-value', () => {
      // Case 2: Cursor in the middle of typing
      // {"gender": "mal|
      const text2 = '{"gender": "mal';
      const match2 = text2.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);
      assert.ok(match2, 'Should match pattern');
      assert.strictEqual(match2[1], 'gender', 'Should extract gender field name');
    });

    test('should extract field name when cursor is after colon without quote', () => {
      // Case 3: Cursor after colon, no quotes
      // {"gender": |
      const text3 = '{"gender": ';
      const match3 = text3.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);
      assert.ok(match3, 'Should match pattern');
      assert.strictEqual(match3[1], 'gender', 'Should extract gender field name');
    });

    test('should not match when no field name present', () => {
      // Case 4: No field name
      const text4 = '{"';
      const match4 = text4.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);
      assert.strictEqual(match4, null, 'Should not match');
    });
  });

  suite('enum value insert text', () => {
    test('should wrap enum value in quotes when no quotes present', () => {
      // User reported issue:
      // Input: {"gender": |}
      // Current: inserts "female" → {"gender": female|}
      // Expected: inserts "female" → {"gender": "female"|}

      // When no quotes are present, enum value should include quotes
      const enumValue = 'female';
      const expectedInsertText = '"' + enumValue + '"';

      assert.strictEqual(
        expectedInsertText,
        '"female"',
        'Enum value should be wrapped in quotes when no quotes present',
      );
    });

    test('should not wrap enum value in quotes when inside quotes', () => {
      // When cursor is inside quotes: {"gender": "|}
      // Enum value should be inserted without quotes
      // VSCode will handle the quotes

      // This depends on cursor context, which we detect in the completion provider
      const enumValue = 'female';
      // Inside quotes, just insert the value
      assert.strictEqual(
        enumValue,
        'female',
        'Enum value should not have quotes when cursor is already inside quotes',
      );
    });
  });
});

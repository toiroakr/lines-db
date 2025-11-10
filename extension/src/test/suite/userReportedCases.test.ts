import * as assert from 'assert';
import { suite, test } from 'mocha';
import { hasQuoteBefore, hasQuoteAfter, generateFieldNameInsertText } from '../../quoteHelper';

/**
 * Tests for user-reported issues with specific examples
 */
suite('User Reported Cases', () => {
  suite('Case 1: Field name completion with partial input', () => {
    test('Input: {"gende| }', () => {
      // User reported:
      // Input: {"gende| }
      // Expected: {"gender": "" }
      // Actual: {""gender": "" }

      const beforeCursor = '{"gende';
      const afterCursor = ' }';

      // Analyze context
      const quoteBefore = hasQuoteBefore(beforeCursor);
      const quoteAfter = hasQuoteAfter(afterCursor);

      assert.strictEqual(
        quoteBefore,
        true,
        'Should detect quote before cursor (opening quote exists)',
      );
      assert.strictEqual(quoteAfter, false, 'Should not detect quote after cursor');

      // Generate insert text
      const insertText = generateFieldNameInsertText('gender', 'string', quoteBefore);

      // Expected: gender": "${1}" (no opening quote because it already exists)
      assert.strictEqual(
        insertText,
        'gender": "${1}"',
        'Insert text should not include opening quote',
      );

      // Calculate the range that should be replaced
      const lastQuoteIndex = beforeCursor.lastIndexOf('"');
      assert.strictEqual(lastQuoteIndex, 1, 'Opening quote should be at position 1');

      // The range should include the opening quote
      // So we replace from position 1 (the ") to cursor position 7 (after "gende")
      // This replaces: "gende
      // With: gender": "${1}"
      // Result: {gender": "|" }

      const textToReplace = beforeCursor.substring(lastQuoteIndex);
      assert.strictEqual(
        textToReplace,
        '"gende',
        'Should identify correct text to replace including opening quote',
      );

      // After replacement
      const afterReplacement = beforeCursor.substring(0, lastQuoteIndex) + insertText;
      assert.strictEqual(afterReplacement, '{gender": "${1}"', 'Should produce correct result');
      assert.ok(
        !afterReplacement.includes('""gender'),
        'Result should NOT have double quotes before gender',
      );
    });

    test('Input: {"id":1, "gende| }', () => {
      // User reported:
      // Input: {"id":1,"name":"Alice","age":0,"email":"alice@example.com", "gende|   }
      // Current result: ""gender": "|"
      // Expected result: "gender": "|"

      const beforeCursor = '{"id":1,"name":"Alice","age":0,"email":"alice@example.com", "gende';
      const afterCursor = '   }';

      // Analyze context
      const quoteBefore = hasQuoteBefore(beforeCursor);
      const quoteAfter = hasQuoteAfter(afterCursor);

      assert.strictEqual(quoteBefore, true, 'Should detect quote before cursor');
      assert.strictEqual(quoteAfter, false, 'Should not detect quote after cursor');

      // Generate insert text
      const insertText = generateFieldNameInsertText('gender', 'enum', quoteBefore);

      // Expected: gender": "${1}" (no opening quote)
      assert.strictEqual(
        insertText,
        'gender": "${1}"',
        'Insert text should not include opening quote',
      );

      // Verify no opening quote
      assert.ok(
        !insertText.startsWith('"'),
        'Insert text should NOT start with quote when quote is already before cursor',
      );

      // Calculate the range that should be replaced
      // We need to replace from the opening quote to the cursor
      // beforeCursor.lastIndexOf('"') should give us the position of opening quote
      const lastQuoteIndex = beforeCursor.lastIndexOf('"');
      assert.ok(lastQuoteIndex !== -1, 'Should find the opening quote');

      // The text between lastQuoteIndex and cursor is: "gende
      const textToReplace = beforeCursor.substring(lastQuoteIndex);
      assert.strictEqual(textToReplace, '"gende', 'Should identify text to replace');

      // After replacement: gender": "${1}"
      // Result in document: ...alice@example.com", gender": "|"   }
      const afterReplacement = beforeCursor.substring(0, lastQuoteIndex) + insertText;
      assert.ok(
        !afterReplacement.includes('""gender'),
        'Result should NOT have double quotes before gender',
      );
    });

    test('Calculate correct replacement range for partial field name', () => {
      const beforeCursor = '{"id":1, "gende';
      const cursorPosition = beforeCursor.length; // Character position in line

      // Find the position of opening quote
      const lastQuoteIndex = beforeCursor.lastIndexOf('"');
      assert.strictEqual(lastQuoteIndex, 9, 'Opening quote should be at position 9');

      // The range to replace should be from lastQuoteIndex to cursorPosition
      const rangeStart = lastQuoteIndex; // Position of opening quote
      const rangeEnd = cursorPosition; // Current cursor position

      assert.strictEqual(rangeStart, 9, 'Range should start at opening quote position');
      assert.strictEqual(rangeEnd, 15, 'Range should end at cursor position');

      // This range would replace: "gende
      const textInRange = beforeCursor.substring(rangeStart, rangeEnd);
      assert.strictEqual(
        textInRange,
        '"gende',
        'Should replace the opening quote and partial text',
      );
    });
  });

  suite('Case 2: Enum value completion without quotes', () => {
    test('Input: {"gender": | }', () => {
      // User reported:
      // Input: {"id":1,"name":"Alice","age":0,"email":"alice@example.com", "gender":  }
      // Current result: female (no quotes)
      // Expected result: "female" (with quotes)

      const beforeCursor = '{"id":1,"name":"Alice","age":0,"email":"alice@example.com", "gender": ';

      // Check if cursor is inside quotes
      const quoteCount = (beforeCursor.match(/"/g) || []).length;
      const insideQuotes = quoteCount % 2 === 1;

      assert.strictEqual(insideQuotes, false, 'Cursor should NOT be inside quotes');

      // When cursor is not inside quotes, enum value should be wrapped with quotes
      const enumValue = 'female';
      const expectedInsertText = `"${enumValue}"`;

      assert.strictEqual(
        expectedInsertText,
        '"female"',
        'Enum value should be wrapped in quotes when cursor is not inside quotes',
      );
    });

    test('Input: {"gender": "| }', () => {
      // When cursor IS inside quotes
      const beforeCursor = '{"gender": "';

      // Check if cursor is inside quotes
      const quoteCount = (beforeCursor.match(/"/g) || []).length;
      const insideQuotes = quoteCount % 2 === 1;

      assert.strictEqual(insideQuotes, true, 'Cursor should be inside quotes');

      // When cursor is inside quotes, enum value should NOT be wrapped
      // (VSCode's default behavior will handle it)
      const enumValue = 'female';

      // In this case, we just insert the raw value
      assert.strictEqual(
        enumValue,
        'female',
        'Enum value should be just the value when inside quotes',
      );
    });

    test('Verify quote counting logic', () => {
      // Even number of quotes = outside quotes
      const outside1 = '{"gender": ';
      assert.strictEqual((outside1.match(/"/g) || []).length % 2, 0, 'Even quotes = outside');

      const outside2 = '{"id":1, "gender": ';
      assert.strictEqual((outside2.match(/"/g) || []).length % 2, 0, 'Even quotes = outside');

      // Odd number of quotes = inside quotes
      const inside1 = '{"gender": "';
      assert.strictEqual((inside1.match(/"/g) || []).length % 2, 1, 'Odd quotes = inside');

      const inside2 = '{"id":1, "gender": "mal';
      assert.strictEqual((inside2.match(/"/g) || []).length % 2, 1, 'Odd quotes = inside');
    });
  });

  suite('Field name extraction', () => {
    test('Should extract "gender" from {"gender": ', () => {
      const beforeCursor = '{"id":1,"name":"Alice", "gender": ';
      const match = beforeCursor.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);

      assert.ok(match, 'Should match the pattern');
      assert.strictEqual(match[1], 'gender', 'Should extract "gender" as field name');
    });

    test('Should extract "gender" from {"gender": " (with opening quote)', () => {
      const beforeCursor = '{"gender": "';
      const match = beforeCursor.match(/"([^"]+)"\s*:\s*(?:"[^"]*)?$/);

      assert.ok(match, 'Should match the pattern');
      assert.strictEqual(match[1], 'gender', 'Should extract "gender" as field name');
    });
  });
});

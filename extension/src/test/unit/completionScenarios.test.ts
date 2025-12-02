import { describe, test, expect } from 'vitest';
import {
  getCompletions,
  isInFieldNamePosition,
  extractExistingFields,
  findCurrentFieldName,
  type FieldInfo,
} from '../../completionLogic';

/**
 * Completion scenario test for _User.schema.ts
 *
 * Schema:
 * {
 *   name: string (email),
 *   password: string
 * }
 * FK: name → User.email
 *
 * Test format: "|" represents cursor position
 */

interface CompletionScenario {
  description: string;
  input: string; // "|" is cursor position
  candidates: string[]; // Expected completion labels
  output?: string; // Result after selecting first completion ($1 = snippet placeholder)
  skip?: boolean; // Skip this test (for future implementation)
}

// ============================================================================
// Test Helper Functions
// ============================================================================

/**
 * Parse cursor position from "|" notation
 */
function parseCursorPosition(input: string): { text: string; cursor: number } {
  const cursor = input.indexOf('|');
  if (cursor === -1) {
    throw new Error('Input must contain "|" to indicate cursor position');
  }
  const text = input.replace('|', '');
  return { text, cursor };
}

/**
 * Simulate applying a completion item
 */
function applyCompletion(
  text: string,
  cursor: number,
  insertText: string,
  range?: { start: number; end: number },
): string {
  const start = range?.start ?? cursor;
  const end = range?.end ?? cursor;
  return text.substring(0, start) + insertText + text.substring(end);
}

// ============================================================================
// Test Data
// ============================================================================

// _User.schema.ts fields
const SCHEMA_FIELDS: FieldInfo[] = [
  { name: 'name', type: 'string' },
  { name: 'password', type: 'string' },
];

// FK values (from User.email)
const FK_VALUES = new Map<string, string[]>([['name', ['alice@example.com', 'bob@example.com']]]);

// ============================================================================
// Test Scenarios
// ============================================================================

const scenarios: CompletionScenario[] = [
  // === Full Object Completion (skip - future implementation) ===
  {
    description: '#0a New line (full object completion)',
    input: '|',
    candidates: ['name', 'password'],
    output: '{"name": "${1}", "password": "${2}"}',
    skip: true,
  },
  {
    description: '#0b After opening brace (full object completion)',
    input: '{|',
    candidates: ['name', 'password'],
    output: '{"name": "${1}", "password": "${2}"}',
    skip: true,
  },
  {
    description: '#0c Empty object (full object completion)',
    input: '{|}',
    candidates: ['name', 'password'],
    output: '{"name": "${1}", "password": "${2}"}',
    skip: true,
  },

  // === New Input Scenarios ===
  {
    description: '#2 After opening quote',
    input: '{"|}',
    candidates: ['name', 'password'],
    output: '{"name": "${1}"}',
  },
  {
    description: '#3 After empty quotes',
    input: '{""|}',
    candidates: [],
    output: '{""name": "${1}"}',
  },
  {
    description: '#4 Inside empty quotes',
    input: '{"|}"}',
    candidates: ['name', 'password'],
    output: '{"name": "${1}"}',
  },
  {
    description: '#5 Partial input "n"',
    input: '{"n|}',
    candidates: ['name'],
    output: '{"name": "${1}"}',
  },
  {
    description: '#6 Partial input "na"',
    input: '{"na|}',
    candidates: ['name'],
    output: '{"name": "${1}"}',
  },
  {
    description: '#7 Partial input "pas"',
    input: '{"pas|}',
    candidates: ['password'],
    output: '{"password": "${1}"}',
  },
  {
    description: '#8 After colon (value position)',
    input: '{"name":|}',
    candidates: ['alice@example.com', 'bob@example.com'],
    output: '{"name":"alice@example.com"}',
  },
  {
    description: '#9 Inside value quote',
    input: '{"name":"|}',
    candidates: ['alice@example.com', 'bob@example.com'],
    output: '{"name":"alice@example.com"}',
  },
  {
    description: '#10 Partial value input "a"',
    input: '{"name":"a|}',
    candidates: ['alice@example.com'],
    output: '{"name":"alice@example.com"}',
  },
  {
    description: '#11 Second field after comma',
    input: '{"name":"alice@example.com",|}',
    candidates: ['password'],
    output: '{"name":"alice@example.com","password": "${1}"}',
  },
  {
    description: '#12 Second field with quote',
    input: '{"name":"alice@example.com", "|}',
    candidates: ['password'],
    output: '{"name":"alice@example.com", "password": "${1}"}',
  },
  {
    description: '#13 Password value (no completion)',
    input: '{"password":|}',
    candidates: [],
  },
  {
    description: '#14 Password value inside quote (no completion)',
    input: '{"password":"|}',
    candidates: [],
  },

  // === Edit Scenarios (cursor in middle of completed JSON) ===
  {
    description: '#15 Field name start in complete JSON',
    input: '{"|name":"alice@example.com","password":"secret"}',
    candidates: ['name'],
    output: '{"name": "${1:alice@example.com}","password":"secret"}',
  },
  {
    description: '#16 Field name middle in complete JSON',
    input: '{"na|me":"alice@example.com","password":"secret"}',
    candidates: ['name'],
    output: '{"name": "${1:alice@example.com}","password":"secret"}',
  },
  {
    description: '#17 Value start in complete JSON',
    input: '{"name":"|alice@example.com","password":"secret"}',
    candidates: ['alice@example.com', 'bob@example.com'],
    output: '{"name":"alice@example.com","password":"secret"}',
  },
  {
    description: '#18 Value middle in complete JSON',
    input: '{"name":"al|ice@example.com","password":"secret"}',
    candidates: ['alice@example.com'],
    output: '{"name":"alice@example.com","password":"secret"}',
  },
  {
    description: '#19 Second field name start in complete JSON',
    input: '{"name":"alice@example.com","|password":"secret"}',
    candidates: ['password'],
    output: '{"name":"alice@example.com","password": "${1:secret}"}',
  },
  {
    description: '#20 Second field name middle in complete JSON',
    input: '{"name":"alice@example.com","pass|word":"secret"}',
    candidates: ['password'],
    output: '{"name":"alice@example.com","password": "${1:secret}"}',
  },
  {
    description: '#21 Second value start in complete JSON (no completion)',
    input: '{"name":"alice@example.com","password":"|secret"}',
    candidates: [],
  },

  // === Edge Cases ===
  {
    description: '#22 After closing quote (no completion)',
    input: '{"name":"alice@example.com","password":"secret"|}',
    candidates: [],
  },
  {
    description: '#23 After closing brace (no completion)',
    input: '{"name":"alice@example.com","password":"secret"}|',
    candidates: [],
  },
  {
    description: '#24 Before opening brace (no completion)',
    input: '|{"name":"alice@example.com"}',
    candidates: [],
  },

  // === Real-world Scenarios (from user reports) ===
  {
    description: '#25 Cursor before quote in complete JSON (should NOT complete)',
    input: '{|"name":"sarah.johnson@example.com","password":"password"}',
    candidates: [],
  },
  {
    description: '#26 Cursor in middle of field name with different values',
    input: '{"na|me":"sarah.johnson@example.com","password":"password"}',
    candidates: ['name'],
    output: '{"name": "${1:sarah.johnson@example.com}","password":"password"}',
  },
];

// ============================================================================
// Test Suite
// ============================================================================

describe('Completion Scenarios - _User.schema.ts', () => {
  describe('Context Detection', () => {
    test('isInFieldNamePosition: after {', () => {
      expect(isInFieldNamePosition('{')).toBe(true);
    });

    test('isInFieldNamePosition: after {"', () => {
      expect(isInFieldNamePosition('{"')).toBe(true);
    });

    test('isInFieldNamePosition: after "name":', () => {
      expect(isInFieldNamePosition('{"name":')).toBe(false);
    });

    test('isInFieldNamePosition: after "name":"', () => {
      expect(isInFieldNamePosition('{"name":"')).toBe(false);
    });

    test('isInFieldNamePosition: after value and comma', () => {
      expect(isInFieldNamePosition('{"name":"value",')).toBe(true);
    });

    test('isInFieldNamePosition: after value, comma, and quote', () => {
      expect(isInFieldNamePosition('{"name":"value", "')).toBe(true);
    });
  });

  describe('Existing Fields Extraction', () => {
    test('empty object', () => {
      const fields = extractExistingFields('{');
      expect(fields.size).toBe(0);
    });

    test('one field', () => {
      const fields = extractExistingFields('{"name":"value"');
      expect(fields.size).toBe(1);
      expect(fields.has('name')).toBe(true);
    });

    test('two fields', () => {
      const fields = extractExistingFields('{"name":"v","password":"x"');
      expect(fields.size).toBe(2);
      expect(fields.has('name')).toBe(true);
      expect(fields.has('password')).toBe(true);
    });
  });

  describe('Field Name Detection for Value Completion', () => {
    test('after colon', () => {
      expect(findCurrentFieldName('{"name":')).toBe('name');
    });

    test('after colon and quote', () => {
      expect(findCurrentFieldName('{"name":"')).toBe('name');
    });

    test('with partial value', () => {
      expect(findCurrentFieldName('{"name":"al')).toBe('name');
    });

    test('no field name', () => {
      expect(findCurrentFieldName('{"')).toBeUndefined();
    });
  });

  describe('Completion Scenarios', () => {
    for (const scenario of scenarios) {
      const testFn = scenario.skip ? test.skip : test;
      testFn(`${scenario.description}: ${scenario.input}`, () => {
        const { text, cursor } = parseCursorPosition(scenario.input);
        const completions = getCompletions(text, cursor, SCHEMA_FIELDS, FK_VALUES);

        // 1. Test expected completion labels
        const labels = completions.map((c) => c.label);
        expect(labels).toEqual(scenario.candidates);

        // 2. Test completion result (if output defined and completions exist)
        if (scenario.output && completions.length > 0) {
          const firstCompletion = completions[0];
          const result = applyCompletion(
            text,
            cursor,
            firstCompletion.insertText,
            firstCompletion.range,
          );
          expect(result).toBe(scenario.output);
        }
      });
    }
  });
});

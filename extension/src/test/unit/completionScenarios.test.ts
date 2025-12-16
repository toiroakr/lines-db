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

// Extended schema with enum and boolean fields
const EXTENDED_SCHEMA_FIELDS: FieldInfo[] = [
  { name: 'name', type: 'string' },
  { name: 'role', type: 'enum', enumValues: ['MANAGER', 'STAFF'] },
  { name: 'priority', type: 'enum', enumValues: ['1', '2', '3'] },
  { name: 'active', type: 'boolean' },
  { name: 'status', type: 'enum', enumValues: ['active', 'inactive', 'true', 'false'] },
];

// Schema with various field types for testing type-based value placeholders
const TYPE_SCHEMA_FIELDS: FieldInfo[] = [
  { name: 'title', type: 'string' },
  { name: 'count', type: 'number' },
  { name: 'enabled', type: 'boolean' },
  { name: 'tags', type: 'array' },
  { name: 'metadata', type: 'object' },
];

// Schema with edge cases for string enum vs boolean distinction
const EDGE_CASE_SCHEMA_FIELDS: FieldInfo[] = [
  // String enum that happens to have "true"/"false" as values
  { name: 'stringBool', type: 'enum', enumValues: ['true', 'false'], isStringEnum: true },
  // Regular string enum
  { name: 'role', type: 'enum', enumValues: ['MANAGER', 'STAFF'], isStringEnum: true },
  // Number enum
  { name: 'priority', type: 'enum', enumValues: ['1', '2', '3'], isStringEnum: false },
  // Mixed boolean literal and number
  { name: 'mixed', type: 'enum', enumValues: ['1', 'true'], isStringEnum: false },
  // Pure boolean type
  { name: 'active', type: 'boolean', enumValues: ['true', 'false'] },
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

// Enum and Boolean completion scenarios
const enumBooleanScenarios: CompletionScenario[] = [
  // === String Enum Completion ===
  {
    description: '#E1 String enum - after colon',
    input: '{"role":|}',
    candidates: ['MANAGER', 'STAFF'],
    output: '{"role":"MANAGER"}',
  },
  {
    description: '#E2 String enum - inside quote',
    input: '{"role":"|}',
    candidates: ['MANAGER', 'STAFF'],
    output: '{"role":"MANAGER"}',
  },
  {
    description: '#E3 String enum - partial input "M"',
    input: '{"role":"M|}',
    candidates: ['MANAGER'],
    output: '{"role":"MANAGER"}',
  },
  {
    description: '#E4 String enum - partial input "S"',
    input: '{"role":"S|}',
    candidates: ['STAFF'],
    output: '{"role":"STAFF"}',
  },

  // === Number Enum Completion ===
  {
    description: '#E5 Number enum - after colon',
    input: '{"priority":|}',
    candidates: ['1', '2', '3'],
    output: '{"priority":1}',
  },
  {
    description: '#E6 Number enum - inside quote (fallback shows all values)',
    input: '{"priority":"|}',
    candidates: ['1', '2', '3'],
    output: '{"priority":1}',
  },

  // === Boolean Completion ===
  {
    description: '#E7 Boolean - after colon',
    input: '{"active":|}',
    candidates: ['true', 'false'],
    output: '{"active":true}',
  },
  {
    description: '#E8 Boolean - inside quote (fallback shows all values)',
    input: '{"active":"|}',
    candidates: ['true', 'false'],
    output: '{"active":true}',
  },

  // === Mixed Enum with Boolean Values ===
  {
    description: '#E9 Mixed enum - after colon (string values with true/false)',
    input: '{"status":|}',
    candidates: ['active', 'inactive', 'true', 'false'],
    output: '{"status":"active"}',
  },
  {
    description: '#E10 Mixed enum - inside quote (only string values)',
    input: '{"status":"|}',
    candidates: ['active', 'inactive'],
    output: '{"status":"active"}',
  },

  // === No Completion for Regular String ===
  {
    description: '#E11 Regular string field - no enum completion',
    input: '{"name":"|}',
    candidates: [],
  },

  // === Fallback: No match shows all enum values ===
  {
    description: '#E12 Boolean - no match inside quote shows all values (replaces quoted)',
    input: '{"active":"ho|}',
    candidates: ['true', 'false'],
    output: '{"active":true}',
  },
  {
    description: '#E13 String enum - partial match filters normally',
    input: '{"role":"M|}',
    candidates: ['MANAGER'],
    output: '{"role":"MANAGER"}',
  },
  {
    description: '#E14 String enum - no match shows all string values (replaces quoted)',
    input: '{"role":"X|}',
    candidates: ['MANAGER', 'STAFF'],
    output: '{"role":"MANAGER"}',
  },
  {
    description: '#E15 Number enum - no match inside quote shows all values (replaces quoted)',
    input: '{"priority":"abc|}',
    candidates: ['1', '2', '3'],
    output: '{"priority":1}',
  },
  {
    description: '#E16 Mixed enum - partial match "a" matches "active"',
    input: '{"status":"a|}',
    candidates: ['active'],
    output: '{"status":"active"}',
  },
  {
    description: '#E17 Mixed enum - no match shows all string values (true/false excluded)',
    input: '{"status":"xyz|}',
    candidates: ['active', 'inactive', 'true', 'false'],
    output: '{"status":"active"}',
  },
];

// Type-based value placeholder scenarios for field name completion
const typePlaceholderScenarios: CompletionScenario[] = [
  // === String Field ===
  {
    description: '#T1 String field - value placeholder with quotes',
    input: '{"|}',
    candidates: ['title', 'count', 'enabled', 'tags', 'metadata'],
    output: '{"title": "${1}"}',
  },

  // === Number Field ===
  {
    description: '#T2 Number field - value placeholder without quotes',
    input: '{"title":"test","|}',
    candidates: ['count', 'enabled', 'tags', 'metadata'],
    output: '{"title":"test","count": ${1}}',
  },

  // === Boolean Field ===
  {
    description: '#T3 Boolean field - value placeholder without quotes',
    input: '{"title":"test","count":5,"|}',
    candidates: ['enabled', 'tags', 'metadata'],
    output: '{"title":"test","count":5,"enabled": ${1}}',
  },

  // === Array Field ===
  {
    description: '#T4 Array field - value placeholder with brackets',
    input: '{"title":"test","count":5,"enabled":true,"|}',
    candidates: ['tags', 'metadata'],
    output: '{"title":"test","count":5,"enabled":true,"tags": [${1}]}',
  },

  // === Object Field ===
  {
    description: '#T5 Object field - value placeholder with braces',
    input: '{"title":"test","count":5,"enabled":true,"tags":[],"|}',
    candidates: ['metadata'],
    output: '{"title":"test","count":5,"enabled":true,"tags":[],"metadata": {${1}}}',
  },

  // === Partial input with type-based placeholder ===
  {
    description: '#T6 Number field partial input',
    input: '{"co|}',
    candidates: ['count'],
    output: '{"count": ${1}}',
  },
  {
    description: '#T7 Boolean field partial input',
    input: '{"en|}',
    candidates: ['enabled'],
    output: '{"enabled": ${1}}',
  },
  {
    description: '#T8 Array field partial input',
    input: '{"ta|}',
    candidates: ['tags'],
    output: '{"tags": [${1}]}',
  },
  {
    description: '#T9 Object field partial input',
    input: '{"me|}',
    candidates: ['metadata'],
    output: '{"metadata": {${1}}}',
  },
];

// Edge case scenarios for string enum vs boolean/number distinction
const edgeCaseScenarios: CompletionScenario[] = [
  // === String Enum with "true"/"false" values (should use quoted placeholder) ===
  {
    description: '#EC1 String enum "true"|"false" - field completion with quoted placeholder',
    input: '{"|}',
    candidates: ['stringBool', 'role', 'priority', 'mixed', 'active'],
    output: '{"stringBool": "${1}"}',
  },

  // === Regular String Enum (should use quoted placeholder) ===
  {
    description: '#EC2 String enum - field completion with quoted placeholder',
    input: '{"stringBool":"true","|}',
    candidates: ['role', 'priority', 'mixed', 'active'],
    output: '{"stringBool":"true","role": "${1}"}',
  },

  // === Number Enum (should use unquoted placeholder) ===
  {
    description: '#EC3 Number enum - field completion with unquoted placeholder',
    input: '{"stringBool":"true","role":"MANAGER","|}',
    candidates: ['priority', 'mixed', 'active'],
    output: '{"stringBool":"true","role":"MANAGER","priority": ${1}}',
  },

  // === Mixed number + boolean literal enum (should use unquoted placeholder) ===
  {
    description: '#EC4 Mixed enum (1|true) - field completion with unquoted placeholder',
    input: '{"stringBool":"true","role":"MANAGER","priority":1,"|}',
    candidates: ['mixed', 'active'],
    output: '{"stringBool":"true","role":"MANAGER","priority":1,"mixed": ${1}}',
  },

  // === Boolean type (should use unquoted placeholder) ===
  {
    description: '#EC5 Boolean type - field completion with unquoted placeholder',
    input: '{"stringBool":"true","role":"MANAGER","priority":1,"mixed":true,"|}',
    candidates: ['active'],
    output: '{"stringBool":"true","role":"MANAGER","priority":1,"mixed":true,"active": ${1}}',
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

  describe('Enum and Boolean Completion Scenarios', () => {
    for (const scenario of enumBooleanScenarios) {
      const testFn = scenario.skip ? test.skip : test;
      testFn(`${scenario.description}: ${scenario.input}`, () => {
        const { text, cursor } = parseCursorPosition(scenario.input);
        // Use EXTENDED_SCHEMA_FIELDS and no FK values for enum/boolean tests
        const completions = getCompletions(text, cursor, EXTENDED_SCHEMA_FIELDS, new Map());

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

  describe('Type-based Value Placeholder Scenarios', () => {
    for (const scenario of typePlaceholderScenarios) {
      const testFn = scenario.skip ? test.skip : test;
      testFn(`${scenario.description}: ${scenario.input}`, () => {
        const { text, cursor } = parseCursorPosition(scenario.input);
        // Use TYPE_SCHEMA_FIELDS and no FK values for type placeholder tests
        const completions = getCompletions(text, cursor, TYPE_SCHEMA_FIELDS, new Map());

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

  describe('Edge Case Scenarios - String Enum vs Boolean/Number', () => {
    for (const scenario of edgeCaseScenarios) {
      const testFn = scenario.skip ? test.skip : test;
      testFn(`${scenario.description}: ${scenario.input}`, () => {
        const { text, cursor } = parseCursorPosition(scenario.input);
        // Use EDGE_CASE_SCHEMA_FIELDS and no FK values for edge case tests
        const completions = getCompletions(text, cursor, EDGE_CASE_SCHEMA_FIELDS, new Map());

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

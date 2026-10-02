import { describe, it, expect } from 'vitest';
import { keepUnknownFields } from './merge-fields.js';

describe('keepUnknownFields', () => {
  it('keeps a field the line holds that has no column, where the line holds it', () => {
    expect(
      keepUnknownFields({ id: 1, note: 'kept', name: 'a' }, { id: 1, name: 'b' }, new Set(['id', 'name'])),
    ).toEqual({
      id: 1,
      note: 'kept',
      name: 'b',
    });
  });

  it('keeps a field named __proto__ as a field, not as the prototype', () => {
    const line = JSON.parse('{"id":1,"__proto__":{"x":1}}') as Record<string, unknown>;

    const kept = keepUnknownFields(line as never, { id: 1 }, new Set(['id']));

    expect(Object.hasOwn(kept, '__proto__')).toBe(true);
    expect(JSON.stringify(kept)).toBe('{"id":1,"__proto__":{"x":1}}');
  });
});

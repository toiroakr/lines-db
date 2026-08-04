import type { JsonObject, JsonValue } from './types.js';

/**
 * Options for {@link mergeFields}
 */
export interface MergeFieldsOptions {
  /**
   * Fields taken from the computed row. Every other field keeps the value the line holds.
   * A field the computed row has no value for is not written, so the line keeps what it has rather
   * than having a null written over it.
   */
  fields: readonly string[];

  /**
   * The order fields are declared in, used to place a field the line did not have.
   * Defaults to the order the computed row lists its own fields in - a row a schema computed lists
   * them the way that schema declares them.
   */
  keyOrder?: Iterable<string>;
}

/**
 * Lay the named fields of a computed row over the line a JSONL file already holds.
 *
 * A field the line did not have is inserted where the schema declares it rather than appended, so a
 * filled-in `id` lands at the front of the line the way a hand-written row has it. No key the line
 * already had moves, and a key the schema does not declare stays behind the declared ones.
 *
 * @param line - The row as the JSONL file holds it
 * @param computed - The row a schema computed from it, which the named fields are taken from. Only its
 * own fields count: a field the schema does not produce is left to the line even when a name like
 * `toString` would resolve to something on `Object.prototype`. A field it holds as `undefined` is
 * left to the line as well.
 * @param options - The fields to take, and the order they are declared in
 * @returns A new row: the line, with the named fields written into it
 *
 * @example
 * // line:     {"name":"Alice","note":"check"}
 * // computed: {"id":"018f…","name":"Alice","createdAt":"2026-…"}
 * mergeFields(line, computed, { fields: ['id', 'createdAt'] });
 * // {"id":"018f…","name":"Alice","createdAt":"2026-…","note":"check"}
 */
export function mergeFields(
  line: JsonObject,
  computed: Record<string, JsonValue | undefined>,
  options: MergeFieldsOptions,
): JsonObject {
  const rank = new Map<string, number>();
  for (const key of options.keyOrder ?? Object.keys(computed)) {
    // The first mention wins, so a key the order lists twice keeps its earliest place
    if (!rank.has(key)) {
      rank.set(key, rank.size);
    }
  }
  // A key the schema does not declare ranks past every declared one, and so keeps its place
  const rankOf = (key: string): number => rank.get(key) ?? Number.MAX_SAFE_INTEGER;

  const written = new Map<string, JsonValue>();
  for (const field of options.fields) {
    // `Object.hasOwn`, not a check on the value: a field named `toString` would otherwise take what
    // `Object.prototype` holds. A field the computed row has as undefined is left to the line too,
    // since writing undefined would drop the key entirely
    if (Object.hasOwn(computed, field) && computed[field] !== undefined) {
      written.set(field, computed[field]);
    }
  }

  // `Object.hasOwn`, not `field in line`: a field named `toString` would otherwise read as present
  const inserted = Array.from(written.keys())
    .filter((field) => !Object.hasOwn(line, field))
    .sort((a, b) => rankOf(a) - rankOf(b));

  const entries: [string, JsonValue][] = [];
  for (const key of Object.keys(line)) {
    while (inserted.length > 0 && rankOf(inserted[0]) < rankOf(key)) {
      const field = inserted.shift()!;
      entries.push([field, written.get(field)!]);
    }
    entries.push([key, written.has(key) ? written.get(key)! : line[key]]);
  }
  for (const field of inserted) {
    entries.push([field, written.get(field)!]);
  }

  // Not an object literal with assignments: a line holding `__proto__` or `toString` keeps that key
  return Object.fromEntries(entries);
}

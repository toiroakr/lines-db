import type { JsonObject, JsonValue } from './types';

/** Which side of a value a table shows: what the file holds, what the schema makes of it, or both */
export type ValueView = 'input' | 'output' | 'both';

/** The value a field holds in the file: the one on its line, or the row's own when the line lacks it */
export function inputOf(row: JsonObject, input: JsonObject | undefined, name: string): JsonValue | undefined {
  return input && Object.hasOwn(input, name) ? input[name] : row[name];
}

/** Whether the schema made the field something other than what the file holds */
export function differs(row: JsonObject, input: JsonObject | undefined, name: string): boolean {
  // Not null for a missing value: a field the schema removed differs from a null the line holds
  return canonical(inputOf(row, input, name)) !== canonical(row[name]);
}

/** The value as JSON text with object keys in order, so two objects with the same entries read the same */
function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return 'undefined';
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** Whether the schema transformed any value of the rows, so that the two sides are worth choosing between */
export function hasTransformed(rows: JsonObject[], inputs: JsonObject[] | undefined): boolean {
  return rows.some((row, index) => {
    const input = inputs?.[index];
    // Not the row's fields alone: a field only the line holds is one the schema removed or renamed
    const names = new Set([...Object.keys(row), ...Object.keys(input ?? {})]);
    return [...names].some((name) => differs(row, input, name));
  });
}

export interface Shown {
  value: JsonValue | undefined;
  /** The output beside the input, when the view shows both and they differ */
  output?: JsonValue;
  /** Not editable: an output cannot be mapped back to the input that made it */
  readOnly: boolean;
}

/** What a field of a stored row shows under a view */
export function shownOf(row: JsonObject, input: JsonObject | undefined, name: string, view: ValueView): Shown {
  if (view === 'output') return { value: row[name], readOnly: true };
  const value = inputOf(row, input, name);
  return view === 'both' && differs(row, input, name) && row[name] !== undefined
    ? { value, output: row[name], readOnly: false }
    : { value, readOnly: false };
}

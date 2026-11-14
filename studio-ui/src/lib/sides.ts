import type { JsonObject, JsonValue } from './types';

/** Which side of a value a table shows: what the file holds, what the schema makes of it, or both */
export type ValueView = 'input' | 'output' | 'both';

/** The value a field holds in the file: the one on its line, or the row's own when the line lacks it */
export function inputOf(row: JsonObject, input: JsonObject | undefined, name: string): JsonValue | undefined {
  return input && Object.hasOwn(input, name) ? input[name] : row[name];
}

/** Whether the schema made the field something other than what the file holds */
export function differs(row: JsonObject, input: JsonObject | undefined, name: string): boolean {
  return JSON.stringify(inputOf(row, input, name) ?? null) !== JSON.stringify(row[name] ?? null);
}

/** Whether the schema transformed any value of the rows, so that the two sides are worth choosing between */
export function hasTransformed(rows: JsonObject[], inputs: JsonObject[] | undefined): boolean {
  return rows.some((row, index) => Object.keys(row).some((name) => differs(row, inputs?.[index], name)));
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
  return view === 'both' && differs(row, input, name)
    ? { value, output: row[name], readOnly: false }
    : { value, readOnly: false };
}

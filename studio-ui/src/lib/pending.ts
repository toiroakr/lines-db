import type { JsonObject, JsonValue } from './types';

/** An edited row's set values and the fields it hands back to the schema */
interface RowEdit {
  key: JsonValue;
  changes: JsonObject;
  reset: string[];
}

/** The changes made on the page and not saved yet */
export interface Pending {
  /** By the JSON of the primary key, so 1 and "1" stay apart */
  edits: Record<string, RowEdit>;
  inserts: Array<{ id: string; row: JsonObject; dataDir?: string }>;
  deletes: Record<string, JsonValue>;
}

export type CellChange = { kind: 'set'; value: JsonValue } | { kind: 'reset' };

const keyOf = (key: JsonValue): string => JSON.stringify(key);

export const emptyPending = (): Pending => ({ edits: {}, inserts: [], deletes: {} });

function editOf(pending: Pending, key: JsonValue): RowEdit {
  return pending.edits[keyOf(key)] ?? { key, changes: {}, reset: [] };
}

function withEdit(pending: Pending, edit: RowEdit): Pending {
  const edits = { ...pending.edits };
  if (Object.keys(edit.changes).length === 0 && edit.reset.length === 0) delete edits[keyOf(edit.key)];
  else edits[keyOf(edit.key)] = edit;
  return { ...pending, edits };
}

export function setCell(pending: Pending, key: JsonValue, field: string, value: JsonValue): Pending {
  const edit = editOf(pending, key);
  return withEdit(pending, {
    key,
    changes: { ...edit.changes, [field]: value },
    reset: edit.reset.filter((name) => name !== field),
  });
}

export function resetCell(pending: Pending, key: JsonValue, field: string): Pending {
  const edit = editOf(pending, key);
  const { [field]: _dropped, ...changes } = edit.changes;
  return withEdit(pending, { key, changes, reset: [...edit.reset.filter((name) => name !== field), field] });
}

/**
 * Set a field a form edits, or drop its change once it holds the value the file does again. A field
 * the file does not hold (undefined) keeps the change: setting it writes it to the file
 */
export function setOrRevertCell(
  pending: Pending,
  key: JsonValue,
  field: string,
  value: JsonValue,
  fileValue: JsonValue | undefined,
): Pending {
  return fileValue !== undefined && JSON.stringify(value) === JSON.stringify(fileValue)
    ? revertCell(pending, key, field)
    : setCell(pending, key, field, value);
}

/** Remove a field from each of the rows named, leaving its value to the schema */
export function resetField(pending: Pending, keys: readonly JsonValue[], field: string): Pending {
  return keys.reduce((next, key) => resetCell(next, key, field), pending);
}

/** Undo whatever was pending on a cell */
export function revertCell(pending: Pending, key: JsonValue, field: string): Pending {
  const edit = editOf(pending, key);
  const { [field]: _dropped, ...changes } = edit.changes;
  return withEdit(pending, { key, changes, reset: edit.reset.filter((name) => name !== field) });
}

export function cellChange(pending: Pending, key: JsonValue, field: string): CellChange | undefined {
  const edit = pending.edits[keyOf(key)];
  if (!edit) return undefined;
  if (edit.reset.includes(field)) return { kind: 'reset' };
  return Object.hasOwn(edit.changes, field) ? { kind: 'set', value: edit.changes[field] } : undefined;
}

export function addInsert(pending: Pending, id: string, row: JsonObject = {}, dataDir?: string): Pending {
  return { ...pending, inserts: [...pending.inserts, { id, row, ...(dataDir ? { dataDir } : {}) }] };
}

export function setInsertCell(pending: Pending, id: string, field: string, value: JsonValue | undefined): Pending {
  return {
    ...pending,
    inserts: pending.inserts.map((insert) => {
      if (insert.id !== id) return insert;
      const { [field]: _dropped, ...row } = insert.row;
      return { ...insert, row: value === undefined ? row : { ...row, [field]: value } };
    }),
  };
}

export function removeInsert(pending: Pending, id: string): Pending {
  return { ...pending, inserts: pending.inserts.filter((insert) => insert.id !== id) };
}

export function isDeleted(pending: Pending, key: JsonValue): boolean {
  return Object.hasOwn(pending.deletes, keyOf(key));
}

/** Mark a row for deletion, whether or not it already is */
export function markDeleted(pending: Pending, key: JsonValue): Pending {
  return isDeleted(pending, key) ? pending : toggleDelete(pending, key);
}

export function toggleDelete(pending: Pending, key: JsonValue): Pending {
  const deletes = { ...pending.deletes };
  if (isDeleted(pending, key)) delete deletes[keyOf(key)];
  else deletes[keyOf(key)] = key;
  return { ...pending, deletes };
}

export function countChanges(pending: Pending): number {
  const edited = Object.keys(pending.edits).filter((key) => !Object.hasOwn(pending.deletes, key));
  return edited.length + pending.inserts.length + Object.keys(pending.deletes).length;
}

export interface Batch {
  inserts: JsonObject[];
  insertDataDirs?: string[];
  updates: Array<{ key: JsonValue; changes: JsonObject; resetToDefault?: string[] }>;
  deletes: JsonValue[];
  /** For a table with failing rows, addressed by index: the file its rows were read from */
  revision?: string;
}

export function toBatch(pending: Pending): Batch {
  return {
    inserts: pending.inserts.map(({ row }) => row),
    ...(pending.inserts.some((insert) => insert.dataDir)
      ? { insertDataDirs: pending.inserts.map((insert) => insert.dataDir ?? '') }
      : {}),
    updates: Object.entries(pending.edits)
      .filter(([key]) => !Object.hasOwn(pending.deletes, key))
      .map(([, { key, changes, reset }]) => ({ key, changes, ...(reset.length > 0 ? { resetToDefault: reset } : {}) })),
    deletes: Object.values(pending.deletes),
  };
}

/** The change saving would send for a row, or nothing when it has no pending change */
export function previewRow(pending: Pending, key: JsonValue): Batch | undefined {
  const edit = pending.edits[keyOf(key)];
  if (!edit) return undefined;
  const { key: rowKey, changes, reset } = edit;
  return {
    inserts: [],
    updates: [{ key: rowKey, changes, ...(reset.length > 0 ? { resetToDefault: reset } : {}) }],
    deletes: [],
  };
}

/** The change saving would send for a row if one of its cells took a value, with the row's other pending changes */
export function previewCell(pending: Pending, key: JsonValue, field: string, value: JsonValue): Batch {
  const { key: rowKey, changes, reset } = editOf(setCell(pending, key, field, value), key);
  return {
    inserts: [],
    updates: [{ key: rowKey, changes, ...(reset.length > 0 ? { resetToDefault: reset } : {}) }],
    deletes: [],
  };
}

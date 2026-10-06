import { describe, it, expect } from 'vitest';
import {
  emptyPending,
  setCell,
  resetCell,
  resetField,
  setOrRevertCell,
  addInsert,
  setInsertCell,
  removeInsert,
  toggleDelete,
  countChanges,
  toBatch,
  cellChange,
  previewCell,
  previewRow,
  markDeleted,
} from './pending';

describe('pending changes', () => {
  it('starts with nothing to save', () => {
    expect(countChanges(emptyPending())).toBe(0);
  });

  it('counts each edited row once, however many of its cells changed', () => {
    let pending = setCell(emptyPending(), 1, 'name', 'Alicia');
    pending = setCell(pending, 1, 'age', 31);

    expect(countChanges(pending)).toBe(1);
  });

  it('turns edits, inserts and deletes into the batch the server applies', () => {
    let pending = setCell(emptyPending(), 1, 'name', 'Alicia');
    pending = resetCell(pending, 1, 'age');
    pending = addInsert(pending, 'new-1');
    pending = setInsertCell(pending, 'new-1', 'name', 'Carol');
    pending = toggleDelete(pending, 2);

    expect(toBatch(pending)).toEqual({
      inserts: [{ name: 'Carol' }],
      updates: [{ key: 1, changes: { name: 'Alicia' }, resetToDefault: ['age'] }],
      deletes: [2],
    });
  });

  it('drops an edit of a cell once it is reset to its default, as only one of the two can be saved', () => {
    let pending = setCell(emptyPending(), 1, 'age', 31);
    pending = resetCell(pending, 1, 'age');

    expect(cellChange(pending, 1, 'age')).toEqual({ kind: 'reset' });
    expect(toBatch(pending).updates).toEqual([{ key: 1, changes: {}, resetToDefault: ['age'] }]);
  });

  it('tells an edited cell from one left as loaded', () => {
    const pending = setCell(emptyPending(), 1, 'name', 'Alicia');

    expect(cellChange(pending, 1, 'name')).toEqual({ kind: 'set', value: 'Alicia' });
    expect(cellChange(pending, 1, 'age')).toBeUndefined();
    expect(cellChange(pending, 2, 'name')).toBeUndefined();
  });

  it('undoes a delete when the row is toggled again', () => {
    const pending = toggleDelete(toggleDelete(emptyPending(), 2), 2);

    expect(countChanges(pending)).toBe(0);
  });

  it('forgets an inserted row once it is removed before saving', () => {
    let pending = addInsert(emptyPending(), 'new-1');
    pending = removeInsert(pending, 'new-1');

    expect(countChanges(pending)).toBe(0);
  });

  it('keeps string and number keys apart, as the primary key is matched by its JSON value', () => {
    let pending = setCell(emptyPending(), 1, 'name', 'one');
    pending = setCell(pending, '1', 'name', 'string one');

    expect(toBatch(pending).updates.map(({ key }) => key)).toEqual([1, '1']);
  });
});

describe('previewRow', () => {
  it('checks the pending changes and resets of one row together, leaving the other rows out', () => {
    let pending = setCell(emptyPending(), 1, 'name', 'Alicia');
    pending = resetCell(pending, 1, 'age');
    pending = setCell(pending, 2, 'name', 'Bobby');

    expect(previewRow(pending, 1)).toEqual({
      inserts: [],
      updates: [{ key: 1, changes: { name: 'Alicia' }, resetToDefault: ['age'] }],
      deletes: [],
    });
  });

  it('gives nothing to check for a row with no pending change', () => {
    expect(previewRow(setCell(emptyPending(), 2, 'name', 'Bobby'), 1)).toBeUndefined();
  });
});

describe('previewCell', () => {
  it('checks a cell value together with the other pending changes and resets of its row', () => {
    let pending = setCell(emptyPending(), 1, 'name', 'Alicia');
    pending = resetCell(pending, 1, 'age');
    pending = setCell(pending, 2, 'name', 'Bobby');

    expect(previewCell(pending, 1, 'email', 'a@example.com')).toEqual({
      inserts: [],
      updates: [{ key: 1, changes: { name: 'Alicia', email: 'a@example.com' }, resetToDefault: ['age'] }],
      deletes: [],
    });
  });

  it('checks a value given to a field pending a reset instead of the reset', () => {
    const pending = resetCell(emptyPending(), 1, 'age');

    expect(previewCell(pending, 1, 'age', 30).updates).toEqual([{ key: 1, changes: { age: 30 } }]);
  });
});

describe('markDeleted', () => {
  it('marks a row for deletion, leaving one already marked as it is', () => {
    const once = markDeleted(emptyPending(), 1);

    expect(markDeleted(once, 1)).toEqual(once);
    expect(toBatch(markDeleted(once, 2)).deletes).toEqual([1, 2]);
  });

  it('removes a field from every row named, as removing it from each row would', () => {
    const pending = resetField(setCell(emptyPending(), 2, 'note', 'kept?'), [0, 2], 'note');

    expect(toBatch(pending).updates).toHaveLength(2);
    expect(toBatch(pending).updates).toEqual(
      expect.arrayContaining([
        { key: 0, changes: {}, resetToDefault: ['note'] },
        { key: 2, changes: {}, resetToDefault: ['note'] },
      ]),
    );
  });

  it('records a value a form sets that differs from the one the file holds', () => {
    const pending = setOrRevertCell(emptyPending(), 1, 'name', 'Alicia', 'Alice');

    expect(cellChange(pending, 1, 'name')).toEqual({ kind: 'set', value: 'Alicia' });
  });

  it('leaves no change when a form sets the value the file holds again', () => {
    const edited = setOrRevertCell(emptyPending(), 1, 'tags', ['a', 'b'], ['a']);

    const pending = setOrRevertCell(edited, 1, 'tags', ['a'], ['a']);

    expect(cellChange(pending, 1, 'tags')).toBeUndefined();
    expect(countChanges(pending)).toBe(0);
  });

  it('records a value a form sets on a field the file does not hold, though it equals the one the schema fills in', () => {
    const pending = setOrRevertCell(emptyPending(), 1, 'age', 20, undefined);

    expect(cellChange(pending, 1, 'age')).toEqual({ kind: 'set', value: 20 });
  });
});

describe('addInsert', () => {
  it('keeps the insert destination through cell edits and sends it with the batch', () => {
    let pending = addInsert(emptyPending(), 'new-local', { id: 3, name: 'Ada' }, '/local');
    pending = setInsertCell(pending, 'new-local', 'name', 'Ada Byron');
    expect(toBatch(pending)).toMatchObject({ inserts: [{ id: 3, name: 'Ada Byron' }], insertDataDirs: ['/local'] });
  });

  it('adds a new row holding the fields it is given', () => {
    const pending = addInsert(emptyPending(), 'new-1', { name: 'Ada' });

    expect(pending.inserts).toEqual([{ id: 'new-1', row: { name: 'Ada' } }]);
  });
});

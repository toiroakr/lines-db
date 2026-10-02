import { describe, it, expect } from 'vitest';
import {
  emptyPending,
  setCell,
  resetCell,
  addInsert,
  setInsertCell,
  removeInsert,
  toggleDelete,
  countChanges,
  toBatch,
  cellChange,
  previewCell,
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
});

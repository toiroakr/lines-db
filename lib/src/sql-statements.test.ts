import { describe, it, expect } from 'vitest';
import { splitStatements } from './sql-statements.js';

describe('splitStatements', () => {
  it('splits at a semicolon', () => {
    expect(splitStatements('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('drops empty statements', () => {
    expect(splitStatements(';; SELECT 1 ;')).toEqual(['SELECT 1']);
  });

  it('does not split at a semicolon inside a block comment, and leaves the comment out', () => {
    expect(splitStatements('/* ; */ COMMIT')).toEqual(['COMMIT']);
  });

  it('does not split at a semicolon inside a line comment, and leaves the comment out', () => {
    expect(splitStatements('-- a ; b\nCOMMIT')).toEqual(['COMMIT']);
  });

  it('reads a comment as the whitespace it is, so words around it stay apart', () => {
    expect(splitStatements('PRAGMA/**/query_only = OFF')).toEqual(['PRAGMA query_only = OFF']);
  });

  it('does not split at a semicolon inside quoted text', () => {
    expect(splitStatements(`SELECT 'a;b'; COMMIT`)).toEqual([`SELECT 'a;b'`, 'COMMIT']);
    expect(splitStatements('SELECT "a;b"; COMMIT')).toEqual(['SELECT "a;b"', 'COMMIT']);
    expect(splitStatements('SELECT `a;b`; COMMIT')).toEqual(['SELECT `a;b`', 'COMMIT']);
    expect(splitStatements('SELECT [a;b]; COMMIT')).toEqual(['SELECT [a;b]', 'COMMIT']);
  });

  it('keeps a doubled quote inside quoted text, which does not end it', () => {
    expect(splitStatements(`SELECT 'it''s; ok'; COMMIT`)).toEqual([`SELECT 'it''s; ok'`, 'COMMIT']);
  });

  it('does not read a comment marker inside quoted text as a comment', () => {
    expect(splitStatements(`SELECT '--'; COMMIT`)).toEqual([`SELECT '--'`, 'COMMIT']);
  });

  it('reads the rest of the text as the comment when it is never closed', () => {
    expect(splitStatements('SELECT 1; /* ; COMMIT')).toEqual(['SELECT 1']);
  });

  it('keeps a trigger body whole, as the semicolons in it do not end the trigger', () => {
    const trigger = 'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET x = 1; UPDATE b SET y = 2; END';
    expect(splitStatements(`${trigger}; COMMIT`)).toEqual([trigger, 'COMMIT']);
  });

  it('keeps a trigger body whole for a temporary trigger and one with IF NOT EXISTS', () => {
    const temporary = 'CREATE TEMP TRIGGER t AFTER INSERT ON a BEGIN DELETE FROM b; END';
    const guarded = 'create trigger if not exists t after insert on a begin delete from b; end';
    expect(splitStatements(`${temporary}; ${guarded}`)).toEqual([temporary, guarded]);
  });

  it('does not take the END of a CASE in a trigger body for the end of the trigger', () => {
    const trigger =
      'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET x = CASE WHEN 1 THEN 1 ELSE 2 END; DELETE FROM c; END';
    expect(splitStatements(`${trigger}; SELECT 1`)).toEqual([trigger, 'SELECT 1']);
  });
});

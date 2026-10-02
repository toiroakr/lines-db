---
'@toiroakr/lines-db': minor
---

feat: choose to write back only the fields a user wrote, leaving the values a schema fills in out of the file

- `writeFilledValues: 'primaryKey'` on the config, or on a single `sync()`, writes back the fields a row's line holds, the fields an `insert()` / `batchInsert()` was given, the fields an `update()` / `batchUpdate()` changed, and the fields named in `writeBackFields` / `fields`. A value the validation schema fills in - a default, or a field it computes - stays out of the line, except a primary key the schema generates, which is written so the row keeps it. The default, `'all'`, writes every value as before.
- `insert()` and `batchInsert()` store the rows as the schema validated them, so a field the row omits holds the value the schema fills in instead of failing with `NOT NULL constraint failed`.
- `update(..., { resetToDefault: ['age'] })` hands a field back to the schema: the row holds the value the schema fills in, and with `writeFilledValues: 'primaryKey'` its line loses the field.
- `findWithDefaults(tableName)` resolves to every row with the fields the schema filled in on it.

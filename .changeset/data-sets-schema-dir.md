---
'@toiroakr/lines-db': minor
---

feat: validate data sets composed from several data directories against a shared schema directory

- `DatabaseConfig.schemaDir` sets where `<Table>.schema.{ts,mts,cts}` files are looked up, for both validation and foreign key discovery, so `{ dataDir: 'seed/data/cogs', schemaDir: 'seed/data' }` no longer fails with `Schema file not found`. When unset, a schema is looked up next to each of the table's JSONL files as before. `SchemaLoader.loadSchema()` and `SchemaLoader.hasSchema()` take the same directory as an optional second argument.
- `DatabaseConfig.dataDir` also takes a list of directories. A table found in more than one of them has the rows of each file, in the order the list gives, and validation, unique indexes and foreign keys run over those rows together: a data set can reference rows of a base set, and an id defined in two sets is reported as a violation. `ValidationErrorDetail.file` / `rowIndex` and the `file` / `line` of a `JsonlParseError` point at the file the row came from and its position in that file.
- A database whose `dataDir` lists several directories is read-only: `insert`, `update`, `delete`, their `batch*` forms, `sync()` and SQL that writes through `execute()` or `query()` return an error without changing the database or the files, since such rows have no single file to be written back to.

Breaking: `DatabaseConfig.dataDir` is now typed `string | readonly string[]`, so code that reads it back as a `string` no longer type-checks.

fix: a foreign key checked after a circular dependency is now reported at the index of the offending row. It was taken from the SQLite rowid, which for an integer primary key is the id itself, so a table whose ids did not run 1..N in file order reported `id - 1` instead.

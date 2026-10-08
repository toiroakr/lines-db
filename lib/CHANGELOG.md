# @toiroakr/lines-db

## 0.15.1

### Patch Changes

- c7d2668: Add named dataset configuration for CLI and programmatic use. Export `loadDatasetConfig(path?, { datasets?: string[] | "all" })` returning a database configuration; omit `datasets` or use `[]` for base only, pass an array to combine named sets in order, or use `"all"` to combine every set. `validate` without a positional path reads `lines-db.config.json` and validates only `base`; Repeated `--dataset <name>` flags add named sets in order and `--all-datasets` combines all sets. `--config <path>` selects another configuration, and data and schema paths resolve relative to that file. Existing positional file and directory validation remains unchanged. Reject nonexistent or non-directory schema paths to prevent skipped validation. Reject invalid configurations, unknown datasets and conflicting options; deduplicate overlapping data directories before validation.
- 19614fc: Support shared schema directories when editing Studio data sets, and edit composed data sets by routing updates and deletes to source files and selecting an insert destination, with conflict detection and rollback across files.

## 0.15.0

### Minor Changes

- 798196b: feat: add `lines-db fill` and `fillFields()` to fill the values a table computes into JSONL rows missing them
  
  `fillFields({ path, fields })` fills the named fields - by default each table's primary key - into the rows that have no value for them, with the values each table computes for a row: its validation schema's value by default, or the function `loadFiller` builds from the schema module (such as a generated create-time `hook`). A value already in the file is never replaced, a line that gains nothing is left byte for byte (CRLF included), a line that gains a value is written with its keys in the order the computed row lists them, every value is computed before any file is written, and a file saved by another tool after it was read stops the fill with a `JsonlConflictError` before any file is written. The result lists the filled files, the tables without a schema file, the lines that are not JSON objects, and the named fields no table produced a value for. `lines-db fill <path> [--fields a,b]` runs it with the validation schemas. A file starting with a byte order mark is read past the mark, which the filled file keeps. The filled files are written to temporary files and replace the originals only once all are written, and the files already replaced are put back if a later one fails; the error names any file that could not be put back. A filled file keeps its permissions.
- 798196b: feat: add `LinesDB.hasExternalChanges()` to tell whether the files changed since the database read them
  
  It resolves to `true` when a JSONL file the database read or wrote was edited or removed, a JSONL file was added to or removed from a data directory, or a table's schema file was edited, added or removed since `initialize()` or the database's last write. `findExternalChanges()` resolves to the files themselves, for telling which table an outside edit touched. A long-running process can call either to create the database again and load the current files before it serves or writes stale rows.
- 825b9d2: fix!: refuse to write a table back over a JSONL file changed after the database read it
  
  A sync used to write the database's rows over the file, so a line added or a value edited in the file after `initialize()` was silently lost. The sync now leaves such a file alone and fails with a `JsonlConflictError` (exported as a type) naming the file; create the database again and call `initialize()` to load the current file before writing.
- 798196b: fix!: fail to initialize when a table's schema file cannot be loaded
  
  A schema file that failed to import - a syntax error, a package it cannot resolve - or that exports no Standard Schema was ignored, and its table was loaded without validation, so rows were then written without the checks the file means to make. `initialize()` now fails with the file and the reason instead.
- 798196b: feat: add `lines-db studio` to browse and edit tables in the browser
  
  - `lines-db studio <dataDir>` starts a local web UI (`http://127.0.0.1:4848`; `--port`, `--open`, `--write-filled-values`) that lists the tables of `dataDir` with their row counts and shows a table as a grid, built with React and shadcn/ui and shipped prebuilt (no new runtime dependency). Edits, new records and deletions stay pending, highlighted in the grid, until **Save N changes** writes them in one transaction through `update()` / `insert()` / `delete()` (`POST /api/tables/:name/changes`); a value the schema rejects writes nothing and is shown with the change it came from. A table without a primary key, or with a row whose primary key is null, is shown read-only. The table list can be collapsed, which the browser remembers, and opens as a drawer on a narrow screen.
  - A cell's editor validates the value as you type through `POST /api/tables/:name/check`, which runs the change in a transaction that is rolled back, and lists the issues under the field. A JSON column opens in a dialog with a highlighting editor that marks syntax errors and accepts comments and trailing commas, which are dropped as the value is saved as plain JSON. A banner above the grid counts the unsaved changes and saves or discards them. **Schema** opens on the table's declared definition (columns, foreign keys, indexes), with a **Code** tab for the schema file as it is on disk, highlighted; a table with failing rows shows only the code (`GET /api/tables/:name/schema`). The columns are read from the types of the schema file (its Standard Schema `types`) with the TypeScript of the project, through the compiler API of TypeScript 5 and 6 or the Corsa API of TypeScript 7.1 and later (`typescript` is an optional peer dependency), and are marked as inferred from the rows when that is not possible.
  - A table with rows that fail validation on load is shown as its JSONL file holds it, with the failing rows and cells marked and their issues listed; a fix is checked with `validateRow()` and written to that row's line only, and the table is loaded as usual once every row passes. Adding and deleting rows is off until then. A field the schema refuses as a key is marked **not in schema**, and its column header removes it from every row at once. The studio loads the tables row by row, so a foreign-key or NOT NULL violation marks its row instead of stopping the start, a save reports the edited rows that still fail such a check, and a fixed file keeps its permissions. The studio watches the data directory and pushes a `changed` event over Server-Sent Events (`/api/events`) when the files change on disk or a save succeeds, and the page reloads its rows unless a cell or a new row is being edited. A JSONL file changed by another tool is not overwritten: a save that would write over it (`JsonlConflictError`) answers 409 naming the file, and the tables are reloaded from the files.
  - A save writes the fields the user wrote and leaves the values the schema fills in out of the file (`writeFilledValues: 'primaryKey'`; `--write-filled-values all` writes them too). A value the schema filled in is shown with a **default** mark, and **Remove field** takes a field out of the row, leaving its value to the schema.
  - The token generated at start-up is handed to the page the server serves, kept in `sessionStorage` and sent with each request, and a request without it is refused with 401; another site cannot read the page, so it cannot get the token. It answers only requests whose `Host` is the local server, accepts writes only as `application/json` and not from another `Origin`, and serves its page with a Content-Security-Policy that allows scripts and styles from itself only.
- 085f7c4: fix!: refuse writes made through the database while a `transaction()` callback is running
  
  `transaction(fn)` now passes `fn` an object of its own instead of the database itself, and a write made through the database (`db.insert()` / `db.update()` / `db.delete()`, their batch variants, `execute()`, a `query()` that changes rows, and SQL on `db.getDb()`) while the transaction is open returns a failed Result or throws, instead of joining the transaction. Before, such a write from unrelated code running while an async callback awaited was reported as done, then rolled back with the transaction if the callback threw, or committed with it otherwise. Writes are synchronous, so they are refused rather than queued until the transaction ends. Code inside the callback must write through the `tx` argument. While a transaction runs, SQL run through the database itself (`getDb()`, `execute()`, `query()`) may only read: a `SELECT`, `VALUES`, `WITH` or `EXPLAIN`, or a pragma that reads such as `PRAGMA table_info(...)`. Every other statement is refused, including transaction control, `SAVEPOINT`, and any `PRAGMA` that sets something, since each could change the transaction. Through the callback's `tx`, SQL runs as before. `getDb()` now returns a wrapper around the SQLite connection instead of the connection itself, also outside a transaction, so a handle or prepared statement kept from before a transaction is refused too when it writes while a callback runs; it runs SQL unchanged when no transaction is open.
- 798196b: fix!: write a transaction back before it commits, and only the tables it changed
  
  - `transaction()` writes the tables back before `COMMIT`, and rolls the transaction back when the write-back fails, so a `JsonlConflictError` or an I/O error no longer leaves the database holding a change its files did not get.
  - Every file a transaction writes back is checked before the first one is written, so a file changed on disk fails the transaction before any file is written. When writing a later file fails, the files already written are put back to what they held, as far as writing them again succeeds.
  - A transaction writes back only the tables it changed through `insert()` / `update()` / `delete()` and their batch variants, together with the tables an `ON DELETE` / `ON UPDATE` `CASCADE` or `SET NULL` action can change in turn; a table it did not change keeps its file as it is, and a change made to that file on disk no longer fails the transaction. Raw SQL through `execute()` or `query()` that changes rows inside a transaction still writes back every table, since the tables it changed are unknown, and `sync()` inside a transaction now fails instead of writing rows the transaction could roll back. A write or sync made while a transaction is starting, or once its callback has returned and it writes its files back, is refused: the first could be written back with rows the transaction later rolls back, and the second would miss the files. This also holds for a statement prepared on `getDb()` inside the transaction and run later. `BEGIN`, `COMMIT`, `END` and `ROLLBACK` through `execute()` / `query()` inside a transaction are refused, as they would end it before its files are written back, and inside a transaction `getDb()` hands out a handle that refuses them too and has the tables written back whole once SQL run on it changes rows.
- 798196b: feat: add `validateRow(tableName, row)` to check a row against a table's schema
  
  It resolves to the row as the schema validates it, or a `ValidationError` with the issues. It also works for a table left out on load because rows failed validation, so a tool can check a fix to such a row before writing it to the file.
- 798196b: feat: choose to write back only the fields a user wrote, leaving the values a schema fills in out of the file
  
  - `writeFilledValues: 'primaryKey'` on the config, or on a single `sync()`, writes back the fields a row's line holds, the fields an `insert()` / `batchInsert()` was given, the fields an `update()` / `batchUpdate()` changed, and the fields named in `writeBackFields` / `fields`. A value the validation schema fills in - a default, or a field it computes - stays out of the line, except a primary key the schema generates, which is written so the row keeps it. The default, `'all'`, writes every value as before. A column an `ON DELETE` / `ON UPDATE` `CASCADE` or `SET NULL` action can change is always written, as the action changes it without a write through the database. A field a migration `transform` set on a row while loading counts as written on that row, and the rows of a table that raw SQL through `execute()` or `query()` may have changed are written back whole, as which fields it set is unknown.
  - `insert()` and `batchInsert()` store the rows as the schema validated them, so a field the row omits holds the value the schema fills in instead of failing with `NOT NULL constraint failed`.
  - `update(..., { resetToDefault: ['age'] })` hands a field back to the schema: the row holds the value the schema fills in, and with `writeFilledValues: 'primaryKey'` its line loses the field.
  - `findWithDefaults(tableName)` resolves to every row with the fields the schema filled in on it.

### Patch Changes

- 798196b: fix: read a JSONL line that holds JSON but not an object, such as `null` or an array, as a `JsonlParseError` naming its file and line, instead of loading it as a row
- 798196b: fix: keep a field the schema does not know in the lines a write-back rewrites
  
  A validation schema that strips unknown keys, such as valibot's `v.object()`, lets a line hold a field the table has no column for. Writing the table back rewrote every line from the database, so changing any row dropped that field from every line, including lines that were not changed. A write-back now keeps such a field where its line holds it, also on a row whose primary key changed. A schema that refuses unknown keys, such as `v.strictObject()`, reports the line as failing validation instead.
- 798196b: fix: let an inferred column be null when some rows lack the field
  
  A table without a schema infers its columns from its rows, and marked a column NOT NULL when no row held `null` for it, even when some rows did not hold the field at all. Those rows store `null` for it, so loading such a table failed with `NOT NULL constraint failed`. A column is now NOT NULL only when every row holds a value for it.
- a88fd28: studio: tell an open page that the files changed on disk when a value check is the first to notice and reloads the tables. Before, the page heard nothing, as the watcher then found nothing left to reload, so it kept showing the old rows.
- b66133d: feat(studio): edit a row in a form beside the grid, and JSON values as fields
  
  - A row form beside the grid, shown or hidden from the header, edits every field of a row at once; its changes join the pending ones. While it is shown a click on a row shows that row in it and a double click edits the cell; while it is hidden a double click on a row shows it. A foreign key field opens the row it refers to (`GET /api/tables` now lists each table's `references`). The form can be widened by dragging its edge.
  - A JSON value is edited as fields of its own, in the row form and in a cell's editor: a map as a field per key, a list as a field per item and a list of maps as a block per item, with issues shown under the key they are about. Each block switches to a JSON editor.
  - **Remove field** and **Set null** are offered only where the schema takes them, and keys inside a JSON value are added and removed only where the schema takes them: the studio validates a sample row with the change to find out, and lists it on each column of `GET /api/tables` (`nullable`, `optional`, `nested`).
  - **Add record** opens a dialog with a field for each column; the fields left empty are left out of the row, and the whole row is checked as it is filled in.
  - A text field grows with its lines, and Shift+Enter breaks a line. The colors follow Prisma Studio, light and dark, with a toggle in the header; the head of each row and the column headers stay in view as the grid scrolls; and the panes no longer bounce at the ends of a scroll.

## 0.14.0

### Minor Changes

- 117c96e: feat: validate data sets composed from several data directories against a shared schema directory
  
  - `DatabaseConfig.schemaDir` sets where `<Table>.schema.{ts,mts,cts}` files are looked up, for both validation and foreign key discovery, so `{ dataDir: 'seed/data/cogs', schemaDir: 'seed/data' }` no longer fails with `Schema file not found`. When unset, a schema is looked up next to the JSONL file as before; it is required when `dataDir` lists several directories, since a data set directory does not hold the schemas of its tables and they would otherwise be loaded unvalidated. `SchemaLoader.loadSchema()` and `SchemaLoader.hasSchema()` take the same directory as an optional second argument.
  - `DatabaseConfig.dataDir` also takes a list of directories. A table found in more than one of them has the rows of each file, in the order the list gives, and validation, unique indexes and foreign keys run over those rows together: a data set can reference rows of a base set, and an id defined in two sets is reported as a violation. `ValidationErrorDetail.file` / `rowIndex` and the `file` / `line` of a `JsonlParseError` point at the file the row came from and its position in that file.
  - A database whose `dataDir` lists several directories is read-only: `insert`, `update`, `delete`, their `batch*` forms, `sync()` and SQL that writes through `execute()` or `query()` return an error without changing the database or the files, since such rows have no single file to be written back to.
  
  Breaking: `DatabaseConfig.dataDir` is now typed `string | readonly string[]`, so code that reads it back as a `string` no longer type-checks.
  
  fix: a foreign key checked after a circular dependency is now reported at the index of the offending row. It was taken from the SQLite rowid, which for an integer primary key is the id itself, so a table whose ids did not run 1..N in file order reported `id - 1` instead.

## 0.13.0

### Minor Changes

- fbd290c: fix: expose structured file and line metadata for malformed JSONL errors
  
  `JsonlReader.read()` previously threw a plain `Error` whose message contained only the offending text, so callers had no reliable way to determine which file and physical line caused a malformed-JSON failure. It now returns a failed `Result` (see the separate `Result`-type-migration changeset) whose `error` is a `JsonlParseError` (exported from the package entry point) carrying `file` (the path passed to `read()`, the same value `ValidationErrorDetail.file` already carries for schema errors) and `line` (the 1-based physical line, counting blank lines and matching what an editor shows for both LF and CRLF files), while keeping the existing human-readable message. This error propagates unchanged through `LinesDB.initialize()`, so callers such as `tailor seed validate` can link a parse failure back to its source location.
- fbd290c: feat!: migrate the JS programmatic API (`LinesDB`, `JsonlReader`) to a `Result` type instead of throwing
  
  **Breaking change.** Every `LinesDB` method that could previously throw (`initialize`, `find`, `findOne`, `query`, `queryOne`, `execute`, `insert`, `batchInsert`, `update`, `batchUpdate`, `delete`, `batchDelete`, `sync`, `transaction`, `close`) now returns a `Result<T, Error>` — a plain `{ ok: true; value: T } | { ok: false; error: Error }` — instead of throwing or rejecting. `JsonlReader.read()` and `JsonlReader.inferSchema()` do the same. `getSchema`, `getTableNames`, and `getDb` are unaffected since they cannot fail.
  
  A new `Result` type plus `ok`, `err`, and `unwrap` helpers are exported from the package entry point. `unwrap(result)` reads `result.value`, or throws `result.error` when `result.ok` is `false` — the quickest way to restore the previous throw-on-failure behavior at a call site:
  
  ```ts
  import { LinesDB, unwrap } from '@toiroakr/lines-db';
  
  const db = LinesDB.create({ dataDir: './data' });
  unwrap(await db.initialize());
  const users = unwrap(db.find('users'));
  ```
  
  Inside `db.transaction(async (tx) => { ... })`, `tx` is the same Result-returning API, so a failed `tx.insert()`/`tx.update()`/etc. no longer throws on its own and therefore does not roll back the transaction by itself — check the Result (or call `unwrap`) and let the thrown error propagate out of the callback to trigger a rollback.
  
  The CLI (`lines-db validate`/`migrate`/`generate`) is unaffected: it unwraps these Results internally and keeps its existing exit codes and error output.
  
  Migration: wrap existing call sites with `unwrap(...)`, or switch to checking `.ok` where you want to handle a failure without a try/catch (e.g. an expected validation error from `insert`/`update`).

## 0.12.7

### Patch Changes

- df82465: chore(deps): update pnpm to v12
- 3e19767: fix(deps): update dependency @politty/zod to ^0.2.0

## 0.12.6

### Patch Changes

- 149dd11: fix(deps): update dependency zod to ^4.5.4

## 0.12.5

### Patch Changes

- b87c941: fix: revert engines.node requirement from Node 24 back to Node >=22.12.0
  
  The `engines.node` requirement was unintentionally bumped from `>=22.12.0` to `>=24.19.0` as a side effect of a Renovate update that only intended to pin the CI workflow's Node version, not raise the package's minimum supported Node version. No runtime dependency actually requires Node 24. Consumers can now install and run this package on Node 22.12.0 or later again.

## 0.12.4

### Patch Changes

- 937c5a5: fix(deps): update dependency @politty/zod to ^0.1.2

## 0.12.3

### Patch Changes

- 1a16efa: chore(deps): migrate from politty to @politty/zod
- ef529f6: fix(deps): update dependency politty to ^0.11.7
- 66f2ed3: chore(deps): update dependency @changesets/cli to v3
- c0f6205: fix(deps): update dependency politty to ^0.11.8

## 0.12.2

### Patch Changes

- 7ff9a08: fix(deps): update dependency @standard-schema/spec to ^1.1.0
- 8e303a1: fix(deps): update dependency amaro to ^1.1.11

## 0.12.1

### Patch Changes

- 310bdaf: Stop bundling `zod` and `politty` into the CLI binary (`bin/cli.mjs`) and declare them as regular
  `dependencies` instead of `devDependencies`. Both are implementation details of the CLI's argument
  parsing (`src/cli.ts`) — the library's public API (`src/index.ts`) never touches them — but bundling
  them baked in a copy that could drift from the `zod` version `politty` itself requires as a peer
  dependency. Installing them as ordinary dependencies keeps a single, consistent `zod` instance.

  No functional change for consumers: `npx lines-db` and installed CLI usage behave identically, just
  with a smaller bundled binary and `politty`/`zod` resolved from `node_modules` instead.

## 0.12.0

### Minor Changes

- 18bf887: Put a field a line did not have where the schema declares it, instead of at the end of the line, and
  export that merge as `mergeFields` for filling a JSONL file in without a database.

  A write-back appended a key the line was missing, which left a backfilled `id` trailing at the end of
  the row - somewhere no hand-written seed line puts it - and left callers re-reading the file afterwards
  to reorder it themselves:

  ```jsonl
  {"name":"Alice","id":"018f…"}   before
  {"id":"018f…","name":"Alice"}   now
  ```

  The order comes from the row the schema computes, so it is the order the schema declares its fields in.
  A key the line already had never moves, and a key the schema does not declare stays behind the declared
  ones.

  `mergeFields` is that same merge on its own, for when the values come from somewhere other than a query
  and loading the file into SQLite would only get in the way:

  ```typescript
  import { JsonlReader, JsonlWriter, mergeFields } from "@toiroakr/lines-db";

  const rows = await JsonlReader.read("./data/users.jsonl");
  const filled = rows.map((row) =>
    mergeFields(row, fillIds(row), { fields: ["id"] })
  );
  await JsonlWriter.write("./data/users.jsonl", filled);
  ```

  Nothing else in the line is read or checked, so a field in a format a schema would reject cannot keep
  the named ones from being written. A field the computed row has no value for is left alone rather than
  nulled out, and `keyOrder` overrides where a new key lands when the computed row does not list its
  fields in the order the schema declares them.

## 0.11.0

### Minor Changes

- 15cd137: Let a sync write back only the fields you name, instead of always rewriting the whole row.

  Write-back materialized every column, so values a validation schema computed and fields the JSONL
  file omitted were baked into the file - `lines-db migrate` rewrote far more than the transform
  touched. Naming the fields keeps the rest of each line exactly as the file had it:

  ```bash
  # users.jsonl before: {"name":"John"}
  npx lines-db migrate ./data/users.jsonl "(row) => row" --fields id
  # users.jsonl after:  {"name":"John","id":"..."}
  ```

  - `--fields <list>` on the `migrate` CLI
  - `db.sync(table, { fields: ['id'] })` for a single sync
  - `writeBackFields` on the database config, which also covers the automatic sync after insert,
    update, and transaction

  One list covers every table a run touches: a table without a named field has nothing written back to
  it, so a directory of tables that do not all share an `id` works with a single `--fields id`. The CLI
  still rejects a field no table has, and `sync(table, { fields })` rejects a field that one table does
  not have.

  Declaring nothing keeps the previous behaviour of writing every field.

### Patch Changes

- 15cd137: Keep the order a JSONL file lists its rows in when syncing.

  A sync wrote rows back in database order. An integer primary key is SQLite's rowid, so a file whose
  lines were not already sorted by id came back reshuffled - a whole-file diff out of a one-field
  change. Rows now keep the order the file has them in, and rows the file did not have are appended.
  When rows cannot be matched to their lines (no usable primary key and a changed row count), a full
  write-back falls back to database order as before.

- 15cd137: Fix `lines-db migrate <file>` on Windows.

  The command split the given path on `/` and fell back to `.` when it found none, so a Windows path
  turned into a table name and the data directory became the current directory:
  `Table 'D:\...\User' not found in directory '.'`. Paths now go through `node:path`, which is
  separator-aware.

## 0.10.1

### Patch Changes

- 4587fb2: Remove the `js-yaml: '>=4.2.0'` pnpm override. It forced `@manypkg/get-packages` (via `read-yaml-file@1.1.0`, a transitive dependency of `@changesets/cli`) onto js-yaml 4, whose `yaml.safeLoad` was removed, breaking `pnpm changeset version` and the release workflow. Both js-yaml security advisories the override addressed (quadratic-complexity DoS and prototype pollution in merge handling) are already patched in the 3.x line at 3.15.0, so removing the override lets pnpm resolve that dependency to a safe 3.x release without forcing an incompatible major on affected consumers.
- 5450665: Remove the optional `valibot` peerDependency. The library only relies on the `@standard-schema/spec` interface at runtime and in its public types, so no schema library needs to be declared as a peer dependency.

## 0.10.0

### Minor Changes

- 332b239: Drop CJS build and replace tsx with amaro

  - ESM-only build. Node.js 22.12+ (VSCode 1.118+) required.
  - Replace `tsx` runtime dependency with `amaro` for TypeScript schema file loading.

### Patch Changes

- c42865e: Replace commander with politty for the CLI framework. Bundle zod and politty into the CLI binary so they are no longer installed as runtime dependencies for library users.

## 0.9.2

### Patch Changes

- 9982a21: Update runtime dependencies (`commander` to v14.0.3, `@standard-schema/spec` to v1.1.0, `tsx` to v4.21.0) and refresh devDependencies/tooling (migrate from ESLint/Prettier to Oxlint/Oxfmt, TypeScript v6).

## 0.9.1

### Patch Changes

- 4ca2664: fix: validate circular foreign key constraints via deferred validation

  Previously, when two tables had bidirectional foreign keys (e.g., `_User` → `User` and `User` → `_User`), one direction's FK validation was always skipped due to circular dependency detection. Now, circular dependency FKs are validated in a second pass after all tables have been loaded, using SQL queries instead of SQLite FK constraints.

## 0.9.0

### Minor Changes

- 07b35ed: Export ErrorFormatter and related types (ErrorFormatterOptions, ValidationErrorInfo, ForeignKeyErrorInfo) from package entry point

## 0.8.0

### Minor Changes

- c408b92: feat: display per-table validation results for directory validation

  The `validate` command now shows individual results per table when validating a directory, including record counts for successful tables (e.g., `✓ users (3 records)`).

  - Added `TableValidationResult` type and `tableResults` field to `ValidationResult`
  - Each table result includes `tableName`, `valid`, `rowCount`, `errors`, and `warnings`

### Patch Changes

- e61a4ee: fix: gracefully handle foreign key validation when referenced table has errors

  When validating a directory, if a table had validation errors, any table referencing it via foreign key would crash with a misleading `no such table` SQLite error. Now, foreign key constraints to failed tables are skipped with a clear warning (e.g., `⚠ Skipping foreign key validation for table 'child': referenced table 'parent' has validation errors`), and the child table's own schema validation still runs normally.

## 0.7.0

### Minor Changes

- 4597383: feat: support .mts and .cts schema file extensions

  Schema files are now auto-detected with the following priority: `.schema.ts` > `.schema.mts` > `.schema.cts`. Mixed extensions within a single project are supported.

  - Added `--output` option to `generate` command for specifying the output file path (e.g., `--output ./data/db.mts`)
  - Import paths are correctly rewritten: `.ts`→`.js`, `.mts`→`.mjs`, `.cts`→`.cjs`
  - New exported utilities: `findSchemaFile`, `isSchemaFile`, `extractTableNameFromSchemaFile`, `rewriteExtensionForImport`, `SCHEMA_EXTENSIONS`

## 0.6.1

### Patch Changes

- 9ae4075: fix: support foreign key constraints with unique indexes

## 0.6.0

### Minor Changes

- 042c14e: feat!: Refactor validation process and remove Validator class

  fix: extension for latest lines-fb

- b22f4f0: feat: Refactor validation process and enhance database initialization
  - Added detailedValidate option to initialize() for detailed constraint violation reporting
  - Enhanced migrate command to apply transforms during initialization for better performance
  - Implemented batch insert for improved performance with SQLite parameter limits
  - Added support for self-referencing foreign keys (e.g., nullable parent_id columns)
  - Improved error handling and reporting for validation failures
  - Added transform option to initialize() method for data transformation during load
  - Enhanced foreign key dependency resolution
  - Added type-fest as dev dependency

## 0.5.0

### Minor Changes

- 1d60d66: feat: support directory for migration

## 0.4.1

### Patch Changes

- b281dc8: Fix constraint validation in validator to properly detect primary key and unique index violations

  Previously, the validator was not creating indexes from schema metadata and was missing the default primaryKey behavior, causing constraint violations to go undetected. This fix ensures:

  - Indexes (both unique and non-unique) are now properly created from schema metadata in the validation database
  - Primary key defaults to 'id' column when not explicitly specified, matching database.ts behavior
  - Constraint violations are properly detected by inserting rows into an in-memory database and catching SQLite exceptions
  - Detailed error information is extracted from SQLite error messages for better diagnostics

  Added comprehensive regression tests to prevent this issue from recurring.

## 0.4.0

### Minor Changes

- a662484: - Allow flexible schema export methods (support loading from `schema` or `default` exports)
  - Enhance constraint validation by loading data into an actual database (catches unique, primary key, and foreign key violations)
  - Add fallback logic to automatically use `id` column as primary key when it exists and no primary key is explicitly defined

## 0.3.0

### Minor Changes

- 50266c5: - Enhanced database initialization with dependency resolution and error handling
  - Added support for undefined values in schema inference
  - Implemented validation that automatically adds columns during data insertion

## 0.2.1

### Patch Changes

- 0881a89: fix: use tsx for load typescript

## 0.2.0

### Minor Changes

- b8e0afe: feat!: remove bun/deno

### Patch Changes

- 49089e1: fix: skip validation with warning instead of error when schema file is not found

  When validating a directory containing JSONL files, if a schema file is missing for some tables, the validator will now:

  - Skip validation for those files with a warning message instead of throwing an error
  - Display warnings in yellow in the CLI output
  - Continue validation for other files that have schema files

  This allows for more flexible validation workflows where not all tables require validation schemas.

## 0.1.2

### Patch Changes

- 00c623a: chore: update README

## 0.1.1

### Patch Changes

- fce2b5a: chore: update README

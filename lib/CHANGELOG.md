# @toiroakr/lines-db

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

# @toiroakr/lines-db

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

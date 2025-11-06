# @toiroakr/lines-db

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

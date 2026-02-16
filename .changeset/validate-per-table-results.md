---
'@toiroakr/lines-db': minor
---

feat: display per-table validation results for directory validation

The `validate` command now shows individual results per table when validating a directory, including record counts for successful tables (e.g., `✓ users (3 records)`).

- Added `TableValidationResult` type and `tableResults` field to `ValidationResult`
- Each table result includes `tableName`, `valid`, `rowCount`, `errors`, and `warnings`

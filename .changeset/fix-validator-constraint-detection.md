---
'@toiroakr/lines-db': patch
---

Fix constraint validation in validator to properly detect primary key and unique index violations

Previously, the validator was not creating indexes from schema metadata and was missing the default primaryKey behavior, causing constraint violations to go undetected. This fix ensures:

- Indexes (both unique and non-unique) are now properly created from schema metadata in the validation database
- Primary key defaults to 'id' column when not explicitly specified, matching database.ts behavior
- Constraint violations are properly detected by inserting rows into an in-memory database and catching SQLite exceptions
- Detailed error information is extracted from SQLite error messages for better diagnostics

Added comprehensive regression tests to prevent this issue from recurring.

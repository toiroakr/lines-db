---
'@toiroakr/lines-db': patch
---

fix: validate circular foreign key constraints via deferred validation

Previously, when two tables had bidirectional foreign keys (e.g., `_User` → `User` and `User` → `_User`), one direction's FK validation was always skipped due to circular dependency detection. Now, circular dependency FKs are validated in a second pass after all tables have been loaded, using SQL queries instead of SQLite FK constraints.

---
'@toiroakr/lines-db': patch
---

fix: gracefully handle foreign key validation when referenced table has errors

When validating a directory, if a table had validation errors, any table referencing it via foreign key would crash with a misleading `no such table` SQLite error. Now, foreign key constraints to failed tables are skipped with a clear warning (e.g., `⚠ Skipping foreign key validation for table 'child': referenced table 'parent' has validation errors`), and the child table's own schema validation still runs normally.

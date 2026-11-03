---
'lines-db': patch
'@lines-db/studio': patch
---

`lines-db studio` now lists a table whose JSONL file has no rows, and its first row can be added in the studio. The studio reads the columns of such a table from the types of its schema file, so the table is listed when the schema declares its input type through `~standard.types` (zod and valibot do; a hand-written Standard Schema has to declare `types`). Without types, the table stays out of the list as before. `DatabaseConfig` has a new `schemaOfEmptyTable` option to give the columns of a table with no rows. `lines-db validate` no longer says a table has "validation errors" when it only skips the foreign keys that point at an empty table; it says the table has no rows to read its columns from.

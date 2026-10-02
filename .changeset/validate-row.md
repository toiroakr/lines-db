---
'@toiroakr/lines-db': minor
---

feat: add `validateRow(tableName, row)` to check a row against a table's schema

It resolves to the row as the schema validates it, or a `ValidationError` with the issues. It also works for a table left out on load because rows failed validation, so a tool can check a fix to such a row before writing it to the file.

---
'@toiroakr/lines-db': minor
---

feat: add `lines-db fill` and `fillFields()` to fill the values a table computes into JSONL rows missing them

`fillFields({ path, fields })` fills the named fields - by default each table's primary key - into the rows that have no value for them, with the values each table computes for a row: its validation schema's value by default, or the function `loadFiller` builds from the schema module (such as a generated create-time `hook`). A value already in the file is never replaced, a line that gains nothing is left byte for byte (CRLF included), a line that gains a value is written with its keys in the order the computed row lists them, and every value is computed before any file is written. The result lists the filled files, the tables without a schema file, the lines that are not JSON objects, and the named fields no table produced a value for. `lines-db fill <path> [--fields a,b]` runs it with the validation schemas.

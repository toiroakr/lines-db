---
'@toiroakr/lines-db': patch
---

fix: keep a field the schema does not know in the lines a write-back rewrites

A validation schema that strips unknown keys, such as valibot's `v.object()`, lets a line hold a field the table has no column for. Writing the table back rewrote every line from the database, so changing any row dropped that field from every line, including lines that were not changed. A write-back now keeps such a field where its line holds it, also on a row whose primary key changed. A schema that refuses unknown keys, such as `v.strictObject()`, reports the line as failing validation instead.

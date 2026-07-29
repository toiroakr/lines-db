---
'@toiroakr/lines-db': patch
---

Keep the order a JSONL file lists its rows in when syncing.

A sync wrote rows back in database order. An integer primary key is SQLite's rowid, so a file whose
lines were not already sorted by id came back reshuffled - a whole-file diff out of a one-field
change. Rows now keep the order the file has them in, and rows the file did not have are appended.
When rows cannot be matched to their lines (no usable primary key and a changed row count), a full
write-back falls back to database order as before.

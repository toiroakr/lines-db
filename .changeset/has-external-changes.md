---
'@toiroakr/lines-db': minor
---

feat: add `LinesDB.hasExternalChanges()` to tell whether the files changed since the database read them

It resolves to `true` when a JSONL file the database read or wrote was edited or removed, a JSONL file was added to or removed from a data directory, or a table's schema file was edited, added or removed since `initialize()` or the database's last write. A long-running process can call it to create the database again and load the current files before it serves or writes stale rows.

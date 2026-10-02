---
'@toiroakr/lines-db': minor
---

fix!: refuse to write a table back over a JSONL file changed after the database read it

A sync used to write the database's rows over the file, so a line added or a value edited in the file after `initialize()` was silently lost. The sync now leaves such a file alone and fails with a `JsonlConflictError` (exported as a type) naming the file; create the database again and call `initialize()` to load the current file before writing.

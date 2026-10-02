---
'@toiroakr/lines-db': minor
---

fix!: write a transaction back before it commits, and only the tables it changed

- `transaction()` writes the tables back before `COMMIT`, and rolls the transaction back when the write-back fails, so a `JsonlConflictError` or an I/O error no longer leaves the database holding a change its files did not get.
- Every file a transaction writes back is checked before the first one is written, so a file changed on disk fails the transaction before any file is written. When writing a later file fails, the files already written are put back to what they held, as far as writing them again succeeds.
- A transaction writes back only the tables it changed through `insert()` / `update()` / `delete()` and their batch variants; a table it did not change keeps its file as it is, and a change made to that file on disk no longer fails the transaction. Raw SQL through `execute()` inside a transaction still writes back every table, since the tables it changed are unknown.

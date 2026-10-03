---
'@toiroakr/lines-db': minor
---

fix!: refuse writes made through the database while a `transaction()` callback is running

`transaction(fn)` now passes `fn` an object of its own instead of the database itself, and a write made through the database (`db.insert()` / `db.update()` / `db.delete()`, their batch variants, `execute()`, a `query()` that changes rows, and SQL on `db.getDb()`) while the transaction is open returns a failed Result or throws, instead of joining the transaction. Before, such a write from unrelated code running while an async callback awaited was reported as done, then rolled back with the transaction if the callback threw, or committed with it otherwise. Writes are synchronous, so they are refused rather than queued until the transaction ends. Code inside the callback must write through the `tx` argument; reads through the database are not affected. `getDb()` now returns a wrapper around the SQLite connection instead of the connection itself, also outside a transaction, so a handle or prepared statement kept from before a transaction is refused too when it writes while a callback runs; it runs SQL unchanged when no transaction is open.

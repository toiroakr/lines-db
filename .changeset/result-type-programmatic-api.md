---
'@toiroakr/lines-db': minor
---

feat!: migrate the JS programmatic API (`LinesDB`, `JsonlReader`) to a `Result` type instead of throwing

**Breaking change.** Every `LinesDB` method that could previously throw (`initialize`, `find`, `findOne`, `query`, `queryOne`, `execute`, `insert`, `batchInsert`, `update`, `batchUpdate`, `delete`, `batchDelete`, `sync`, `transaction`, `close`) now returns a `Result<T, Error>` — a plain `{ ok: true; value: T } | { ok: false; error: Error }` — instead of throwing or rejecting. `JsonlReader.read()` and `JsonlReader.inferSchema()` do the same. `getSchema`, `getTableNames`, and `getDb` are unaffected since they cannot fail.

A new `Result` type plus `ok`, `err`, and `unwrap` helpers are exported from the package entry point. `unwrap(result)` reads `result.value`, or throws `result.error` when `result.ok` is `false` — the quickest way to restore the previous throw-on-failure behavior at a call site:

```ts
import { LinesDB, unwrap } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
unwrap(await db.initialize());
const users = unwrap(db.find('users'));
```

Inside `db.transaction(async (tx) => { ... })`, `tx` is the same Result-returning API, so a failed `tx.insert()`/`tx.update()`/etc. no longer throws on its own and therefore does not roll back the transaction by itself — check the Result (or call `unwrap`) and let the thrown error propagate out of the callback to trigger a rollback.

The CLI (`lines-db validate`/`migrate`/`generate`) is unaffected: it unwraps these Results internally and keeps its existing exit codes and error output.

Migration: wrap existing call sites with `unwrap(...)`, or switch to checking `.ok` where you want to handle a failure without a try/catch (e.g. an expected validation error from `insert`/`update`).

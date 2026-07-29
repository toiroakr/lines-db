---
'@toiroakr/lines-db': minor
---

Let a sync write back only the fields you name, instead of always rewriting the whole row.

Write-back materialized every column, so values a validation schema computed and fields the JSONL
file omitted were baked into the file - `lines-db migrate` rewrote far more than the transform
touched. Naming the fields keeps the rest of each line exactly as the file had it:

```bash
# users.jsonl before: {"name":"John"}
npx lines-db migrate ./data/users.jsonl "(row) => row" --fields id
# users.jsonl after:  {"name":"John","id":"..."}
```

- `--fields <list>` on the `migrate` CLI
- `db.sync(table, { fields: ['id'] })` for a single sync
- `writeBackFields` on the database config, which also covers the automatic sync after insert,
  update, and transaction

One list covers every table a run touches: a table without a named field has nothing written back to
it, so a directory of tables that do not all share an `id` works with a single `--fields id`. The CLI
still rejects a field no table has, and `sync(table, { fields })` rejects a field that one table does
not have.

Declaring nothing keeps the previous behaviour of writing every field.

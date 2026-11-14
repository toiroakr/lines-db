---
'lines-db': patch
'@lines-db/studio': patch
---

An inserted row's field the validation schema transforms is now written to the JSONL file as it was given, not as the schema made it. With a schema that turns the `code` `"1"` into `"ORD-1"` (a TailorDB `create` hook does this), `insert('orders', { id: 3, code: '1' })` used to write `"ORD-1"`, and the next load of the file turned it into `"ORD-ORD-1"`. It now writes `"1"`, as `update` already did, so the file holds the side a seed file holds and the schema applies its transformation once, on load. This applies to `insert` and `batchInsert` when `writeFilledValues` is `'primaryKey'` (the studio's default); with `'all'` every value the schema gives is still written.

`findWithDefaults()` now also returns `input` for each row: the row as its line holds it, the values before the schema transformed them, without the fields the schema filled in. The studio's rows response carries it as `inputs`, and the studio can show each value as its input, its output (read-only), or both side by side; the input is what a cell and the form edit.

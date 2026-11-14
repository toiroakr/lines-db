---
'lines-db': patch
'@lines-db/studio': patch
---

An inserted row's field the validation schema transforms is now written to the JSONL file as it was given, not as the schema made it. With a schema that turns the `code` `"1"` into `"ORD-1"` (a TailorDB `create` hook does this), `insert('orders', { id: 3, code: '1' })` used to write `"ORD-1"`, and the next load of the file turned it into `"ORD-ORD-1"`. It now writes `"1"`, as `update` already did, so the file holds the side a seed file holds and the schema applies its transformation once, on load. This applies to `insert` and `batchInsert` when `writeFilledValues` is `'primaryKey'` (the studio's default), except for fields named in `writeBackFields` and foreign-key columns a `CASCADE` or `SET NULL` action can change, and values a line cannot hold, such as a bigint, which are still written as the database has them; with `'all'` every value the schema gives is still written.

`findWithDefaults()` now also returns `input` for each row: the row as its line holds it, the values before the schema transformed them, without the fields the schema filled in. The studio's rows response carries it as `inputs`, and the studio can show each value as its input, its output (read-only), or both side by side; the input is what a cell and the form edit.

Updating one field of a row no longer rewrites the other fields of its line with the values the schema made of them: with the line `{"id":1,"code":"a","note":"n"}`, changing only `note` used to write `"code":"ORD-a"`, which the schema turned into `"ORD-ORD-a"` on the next load. With `writeFilledValues: 'primaryKey'`, a field the line holds and nothing set now keeps the line's value; `'all'` still writes the value the schema gives.

A write-back finds the line of a row again by the primary key the schema makes of it, so a table whose schema transforms its primary key keeps the keys its lines hold, and a table without a primary key, and a row whose primary key was changed, find it by the position its line had when the file was read, kept up to date as rows are added and removed. The studio edits as text, in the Input view, a column whose lines hold another type than the schema makes.

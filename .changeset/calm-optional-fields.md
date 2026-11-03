---
'lines-db': patch
---

A table with a schema file no longer refuses a row that leaves out a field every existing row holds, when the schema takes that row. Before, the field was inferred as NOT NULL from the rows on disk, so inserting `{"id":3,"name":"c"}` into a table whose rows all had `nick` failed with `NOT NULL constraint failed: users.nick`, in `insert()` and in the studio's save, although the schema accepted the row. A field the schema fills in, or whose omission the schema rejects, stays as it was.

---
'@toiroakr/lines-db': patch
---

fix: let an inferred column be null when some rows lack the field

A table without a schema infers its columns from its rows, and marked a column NOT NULL when no row held `null` for it, even when some rows did not hold the field at all. Those rows store `null` for it, so loading such a table failed with `NOT NULL constraint failed`. A column is now NOT NULL only when every row holds a value for it.

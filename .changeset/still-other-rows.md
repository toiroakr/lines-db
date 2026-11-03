---
'lines-db': patch
---

Saving one row no longer rewrites the other rows of the file when the write-back writes only the primary key (`writeFilledValues: 'primaryKey'`, the studio's default). Before, a row nothing was written to had every field its line holds replaced by the value the schema computes: with a schema that computes `full` from `a` and `b`, saving row 1 changed `"full":"edited by hand"` in row 3 to `"full":"m-n"`. Such a row is now written as the file holds it.

---
'lines-db': patch
---

A JSON column now gives back a string, a boolean and a number as the value that was inserted. A string such as `"123"`, `"true"`, `"null"` or `'{"a":1}'` used to come back as a number, a boolean, null or an object, and `false` and `true` came back as `0` and `1`. Every value of a JSON column is now stored as JSON text with a string quoted, for rows loaded from a file and for `insert`, `batchInsert`, `update` and `find` conditions alike. Objects and arrays are stored as before, and the JSONL file still holds plain values. In raw SQL, a string in a JSON column is now compared in its quoted form (`WHERE data = '"abc"'`), and `lines-db` no longer warns "Failed to parse JSON column" for a plain string it wrote itself. Rows an older version saved to a database file given as `dbPath` are not rewritten and read as before.

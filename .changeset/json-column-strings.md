---
'lines-db': minor
---

A JSON column now gives back a string, a boolean and a number as the value that was inserted. A string such as `"123"`, `"true"`, `"null"` or `'{"a":1}'` used to come back as a number, a boolean, null or an object, and `false` and `true` came back as `0` and `1`. Every value of a JSON column is now stored as JSON text with a string quoted, for `insert`, `batchInsert`, `update` (including `resetToDefault`) and the conditions of `find`, `update` and `delete` alike. Objects and arrays are stored as before, and the JSONL file still holds plain values.

Breaking for raw SQL: a string in a JSON column is now stored and read back through `query()` in its quoted form, so `WHERE data = 'abc'` becomes `WHERE data = '"abc"'`. `lines-db` also no longer warns "Failed to parse JSON column" for a plain string it wrote itself.

---
'lines-db': patch
---

A boolean, object or array written into a field that no row holds a value in yet is now written back to the JSONL file as it was given. Before, saving `true` into a field that was `null` in every row wrote `1`, and an object wrote JSON text such as `"{\"a\":1}"`, which a schema that takes a boolean or an object then refuses on the next load. A string written first settles the field as text, so a later object is stored as text too, and a write that failed, matched no row or was rolled back leaves the field untyped.

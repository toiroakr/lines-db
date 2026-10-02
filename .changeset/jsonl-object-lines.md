---
'@toiroakr/lines-db': patch
---

fix: read a JSONL line that holds JSON but not an object, such as `null` or an array, as a `JsonlParseError` naming its file and line, instead of loading it as a row

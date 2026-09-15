---
'@toiroakr/lines-db': minor
---

fix: expose structured file and line metadata for malformed JSONL errors

`JsonlReader.read()` previously threw a plain `Error` whose message contained only the offending text, so callers had no reliable way to determine which file and physical line caused a malformed-JSON failure. It now returns a failed `Result` (see the separate `Result`-type-migration changeset) whose `error` is a `JsonlParseError` (exported from the package entry point) carrying `file` (the path passed to `read()`, the same value `ValidationErrorDetail.file` already carries for schema errors) and `line` (the 1-based physical line, counting blank lines and matching what an editor shows for both LF and CRLF files), while keeping the existing human-readable message. This error propagates unchanged through `LinesDB.initialize()`, so callers such as `tailor seed validate` can link a parse failure back to its source location.

---
'lines-db': patch
---

`jsonlRecordLines(content)` is now exported. It applies the rule `JsonlReader` and `lines-db validate` read a JSONL file with (drop one leading byte order mark and each trailing carriage return, skip lines that are blank after trimming, count physical lines) and returns each row's trimmed `text` with its 1-based `line`, so a caller that reports errors by line no longer needs its own copy of the rule.

A row with a character around it that JSON does not allow as whitespace, such as a non-breaking space (`U+00A0`) or a second leading byte order mark, used to fail with `Failed to parse JSON line`. It is now trimmed and loaded, with a warning: `JsonlReader.readSnapshot` returns it in the new `warnings` of its result as `<file>:<line> has U+00A0 around its row, which JSON does not allow`, and `validate` and `initialize` add it to their `warnings` with the table name, which `lines-db validate` prints. Spaces and tabs around a row, which JSON allows, are still trimmed without a warning. A line that is only whitespace, including a non-breaking space, is still skipped without one. `fillFields` (`lines-db fill-fields`) reads such a row the same way, instead of reporting it as a line that is not a JSON object: a row that gains a value is written back trimmed, and a row that gains nothing is left as it was.

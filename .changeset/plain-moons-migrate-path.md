---
'@toiroakr/lines-db': patch
---

Fix `lines-db migrate <file>` on Windows.

The command split the given path on `/` and fell back to `.` when it found none, so a Windows path
turned into a table name and the data directory became the current directory:
`Table 'D:\...\User' not found in directory '.'`. Paths now go through `node:path`, which is
separator-aware.

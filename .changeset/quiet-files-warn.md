---
'lines-db': patch
---

`lines-db validate` now prints a warning on stderr when every table it loaded has zero records (for example when all `.jsonl` files are empty placeholders), so a run that checked nothing no longer looks like a plain success. The exit code stays 0.

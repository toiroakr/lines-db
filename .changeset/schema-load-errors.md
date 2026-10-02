---
'@toiroakr/lines-db': minor
---

fix!: fail to initialize when a table's schema file cannot be loaded

A schema file that failed to import - a syntax error, a package it cannot resolve - or that exports no Standard Schema was ignored, and its table was loaded without validation, so rows were then written without the checks the file means to make. `initialize()` now fails with the file and the reason instead.

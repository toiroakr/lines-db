---
'@toiroakr/lines-db': patch
---

studio: tell an open page that the files changed on disk when a value check is the first to notice and reloads the tables. Before, the page heard nothing, as the watcher then found nothing left to reload, so it kept showing the old rows.

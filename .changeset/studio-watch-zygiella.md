---
'@lines-db/studio': patch
---

Watch the data and schema directories with `zygiella` instead of `fs.watch` for live reload. The Node.js requirement of Studio is now 22.18.0 or later, the same as `lines-db`, which Studio already depends on as a peer.

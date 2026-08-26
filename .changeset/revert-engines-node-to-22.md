---
'@toiroakr/lines-db': patch
---

fix: revert engines.node requirement from Node 24 back to Node >=22.12.0

The `engines.node` requirement was unintentionally bumped from `>=22.12.0` to `>=24.19.0` as a side effect of a Renovate update that only intended to pin the CI workflow's Node version, not raise the package's minimum supported Node version. No runtime dependency actually requires Node 24. Consumers can now install and run this package on Node 22.12.0 or later again.

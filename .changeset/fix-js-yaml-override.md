---
'@toiroakr/lines-db': patch
---

Remove the `js-yaml: '>=4.2.0'` pnpm override. It forced `@manypkg/get-packages` (via `read-yaml-file@1.1.0`, a transitive dependency of `@changesets/cli`) onto js-yaml 4, whose `yaml.safeLoad` was removed, breaking `pnpm changeset version` and the release workflow. Both js-yaml security advisories the override addressed (quadratic-complexity DoS and prototype pollution in merge handling) are already patched in the 3.x line at 3.15.0, so removing the override lets pnpm resolve that dependency to a safe 3.x release without forcing an incompatible major on affected consumers.

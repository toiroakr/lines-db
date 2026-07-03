---
'@toiroakr/lines-db': patch
---

Remove the optional `valibot` peerDependency. The library only relies on the `@standard-schema/spec` interface at runtime and in its public types, so no schema library needs to be declared as a peer dependency.

---
'lines-db': minor
'@lines-db/studio': minor
---

Move the Studio server and browser assets into @lines-db/studio. Install the new package to continue using lines-db studio. Other CLI commands and the database library no longer ship Studio.

Rename the core package from @toiroakr/lines-db to lines-db. Update imports and installation commands to use lines-db.

Update CLI imports, generated types, editor integration, and documentation for the new package names. Publish both packages from the release workflow.

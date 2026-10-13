# @lines-db/studio

## 0.16.1

### Patch Changes

- Updated dependencies [d711b36]
  - lines-db@0.17.0

## 0.16.0

### Minor Changes

- 19259c2: Move the Studio server and browser assets into @lines-db/studio. Install the new package to continue using lines-db studio. Other CLI commands and the database library no longer ship Studio.
  
  Rename the core package from @toiroakr/lines-db to lines-db. Update imports and installation commands to use lines-db.
  
  Update CLI imports, generated types, editor integration, and documentation for the new package names. Publish both packages from the release workflow.
  
  Use the current TypeScript 7.1 synchronous API for Studio schema inspection and verify declared columns with TypeScript 5 and 7.1 in CI.

### Patch Changes

- Updated dependencies [19259c2]
  - lines-db@0.16.0

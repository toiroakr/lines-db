# @lines-db/studio

## 0.16.6

### Patch Changes

- 4bfd4b7: Read the files a schema file imports anew when one of them changed, so an edit to a project file the schema imports, such as a table definition, is validated against instead of the version first loaded. Once the first read has recorded the imports, a file is evaluated again only when it or a file it imports changed, except after a read that failed, so reading the tables again many times does not grow memory with the number of files. A package from `node_modules`, and a file of another package, such as one linked from a workspace, stay one module. A runtime without synchronous module hooks still reads only the schema file itself again, and CommonJS schemas (`.schema.cts`) keep their first evaluation, as before.
  
  `hasExternalChanges()` and `findExternalChanges()` now report an edit to, or the removal of, a project file the schemas imported, so the studio reloads when only a table definition changed. `listSchemaDependencies()` lists the project files a database's schemas imported. With synchronous module hooks, a relative import of a file that was not there when the tables were read is tracked too, so creating the file is reported as a change. Calling `initialize()` again in the same process before an earlier call has finished can leave `hasExternalChanges()` reporting no change for a file edited while the earlier call was reading; the studio reads the tables one reload at a time and is not affected. The studio watches the imported files too, so an open page is told as soon as one of them is edited or created, even when it is outside the watched directories; a file that is not there yet is watched through the directory that would hold it, or the nearest one that exists.
- Updated dependencies [4bfd4b7]
  - lines-db@0.19.1

## 0.16.5

### Patch Changes

- 3833022: Watch the data and schema directories with `zygiella` instead of `fs.watch` for live reload. The Node.js requirement of Studio is now 22.18.0 or later, the same as `lines-db`, which Studio already depends on as a peer.

## 0.16.4

### Patch Changes

- aa9725e: `lines-db studio` now lists a table whose JSONL file has no rows, and a table with a primary key can have its first row added in the studio. The studio reads the columns of such a table from the types of its schema file, so the table is listed when the schema declares its input type through `~standard.types` (zod and valibot do; a hand-written Standard Schema has to declare `types`). Without types, the table stays out of the list as before. `DatabaseConfig` has a new `schemaOfEmptyTable` option to give the columns of a table with no rows. `lines-db validate` no longer says a table has "validation errors" when it only skips the foreign keys that point at an empty table; it says the table has no rows to read its columns from.
- Updated dependencies [8deddc8]
- Updated dependencies [aa9725e]
- Updated dependencies [376a141]
- Updated dependencies [8deddc8]
- Updated dependencies [8deddc8]
  - lines-db@0.19.0

## 0.16.3

### Patch Changes

- 7943f11: Update the bundled Studio UI to matching React and React DOM 19.3.1 versions.

## 0.16.2

### Patch Changes

- Updated dependencies [8f9912e]
  - lines-db@0.18.0

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

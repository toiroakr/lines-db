---
'lines-db': patch
'@lines-db/studio': patch
---

Read the files a schema file imports anew when one of them changed, so an edit to a project file the schema imports, such as a table definition, is validated against instead of the version first loaded. Once the first read has recorded the imports, a file is evaluated again only when it or a file it imports changed, except after a read that failed, so reading the tables again many times does not grow memory with the number of files. A package from `node_modules`, and a file of another package, such as one linked from a workspace, stay one module. A runtime without synchronous module hooks still reads only the schema file itself again, and CommonJS schemas (`.schema.cts`) keep their first evaluation, as before.

`hasExternalChanges()` and `findExternalChanges()` now report an edit to, or the removal of, a project file the schemas imported, so the studio reloads when only a table definition changed. `listSchemaDependencies()` lists the project files a database's schemas imported. An import that was missing when the tables were read is not tracked until they are read again. The studio watches those files too, so an open page is told as soon as one of them is edited, even when it is outside the watched directories.

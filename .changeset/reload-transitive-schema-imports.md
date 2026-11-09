---
'lines-db': patch
'@lines-db/studio': patch
---

Read the files a schema file imports anew when one of them changed, so an edit to a project file the schema imports, such as a table definition, is validated against instead of the version first loaded. A file is evaluated again only when it or a file it imports changed, so reading the tables again many times does not grow memory with the number of files. A package from `node_modules`, and a file of another package, such as one linked from a workspace, stay one module. A runtime without synchronous module hooks still reads only the schema file itself again.

`hasExternalChanges()` and `findExternalChanges()` now report an edit to such a file, so the studio reloads when only a table definition changed. `listSchemaDependencies()` lists the project files a database's schemas import. The studio watches those files too, so an open page is told as soon as one of them is edited, even when it is outside the watched directories.

---
'lines-db': patch
'@lines-db/studio': patch
---

Read the files a schema file imports anew when the tables are read again, so a change to a project file the schema imports, such as a table definition, is validated against instead of the version first loaded. A file imported by several schemas is evaluated once for each read, and a package from `node_modules` stays one module. A runtime without synchronous module hooks (Node.js before 22.15) still reads only the schema file itself again.

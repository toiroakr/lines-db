---
'@toiroakr/lines-db': minor
---

feat: add `lines-db studio` to browse and edit tables in the browser

- `lines-db studio <dataDir>` starts a local web UI (`http://127.0.0.1:4848`; `--port`, `--open`, `--write-filled-values`) that lists the tables of `dataDir` with their row counts and shows a table as a grid, built with React and shadcn/ui and shipped prebuilt (no new runtime dependency). Edits, new records and deletions stay pending, highlighted in the grid, until **Save N changes** writes them in one transaction through `update()` / `insert()` / `delete()` (`POST /api/tables/:name/changes`); a value the schema rejects writes nothing and is shown with the change it came from. A table without a primary key is shown read-only.
- Rows that fail validation on load, whose table is therefore left out, are listed on the page. The studio watches the data directory and pushes a `changed` event over Server-Sent Events (`/api/events`) when the files change on disk or a save succeeds, and the page reloads its rows unless a cell or a new row is being edited. A JSONL file changed by another tool is not overwritten: a save that would write over it (`JsonlConflictError`) answers 409 naming the file, and the tables are reloaded from the files.
- A save writes the fields the user wrote and leaves the values the schema fills in out of the file (`writeFilledValues: 'primaryKey'`; `--write-filled-values all` writes them too). A value the schema filled in is shown with a **default** mark, and **Use default** hands a field back to the schema.
- The server prints a URL holding a token generated for the run; opening it signs the browser in with an HttpOnly, SameSite=Strict cookie, and every other request without the token is refused with 401. It answers only requests whose `Host` is the local server, accepts writes only as `application/json` and not from another `Origin`, and serves its page with a Content-Security-Policy that allows scripts and styles from itself only.

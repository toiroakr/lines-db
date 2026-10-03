---
'@toiroakr/lines-db': patch
---

feat(studio): edit a row in a form beside the grid, and JSON values as fields

- A row form beside the grid, shown or hidden from the header, edits every field of a row at once; its changes join the pending ones. While it is shown a click on a row shows that row in it and a double click edits the cell; while it is hidden a double click on a row shows it. A foreign key field opens the row it refers to (`GET /api/tables` now lists each table's `references`). The form can be widened by dragging its edge.
- A JSON value is edited as fields of its own, in the row form and in a cell's editor: a map as a field per key, a list as a field per item and a list of maps as a block per item, with issues shown under the key they are about. Each block switches to a JSON editor.
- **Remove field** and **Set null** are offered only where the schema takes them, and keys inside a JSON value are added and removed only where the schema takes them: the studio validates a sample row with the change to find out, and lists it on each column of `GET /api/tables` (`nullable`, `optional`, `nested`).
- **Add record** opens a dialog with a field for each column; the fields left empty are left out of the row, and the whole row is checked as it is filled in.
- A text field grows with its lines, and Shift+Enter breaks a line. The colors follow Prisma Studio, light and dark, with a toggle in the header; the head of each row and the column headers stay in view as the grid scrolls; and the panes no longer bounce at the ends of a scroll.

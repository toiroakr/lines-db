---
'@toiroakr/lines-db': minor
---

- Allow flexible schema export methods (support loading from `schema` or `default` exports)
- Enhance constraint validation by loading data into an actual database (catches unique, primary key, and foreign key violations)
- Add fallback logic to automatically use `id` column as primary key when it exists and no primary key is explicitly defined

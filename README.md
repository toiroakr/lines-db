# lines-db

[日本語](./README.ja.md)

lines-db loads JSONL files into SQLite tables. Use it to validate seed data, query test fixtures, and write changes back to the source files. Schemas can use any Standard Schema library, including Valibot and Zod.

## Getting started

Requires Node.js 22.12.0 or later.

```bash
npm install lines-db
```

Create `data/users.jsonl` with one JSON object per line.

```text
{"id":1,"name":"Alice"}
{"id":2,"name":"Bob"}
```

```typescript
import { LinesDB, unwrap } from 'lines-db';

const db = LinesDB.create({ dataDir: './data' });
unwrap(await db.initialize());
const users = unwrap(db.find('users'));
console.log(users);
unwrap(await db.close());
```

For schema definitions, type generation, queries, and write-back options, see the [library documentation](./lib/README.md).

## Studio

Install `@lines-db/studio` to browse and edit the data in a browser.

```bash
npm install -D @lines-db/studio
npx lines-db studio ./data --open
```

Changes are staged until you save. Studio validates them against the schema before writing to the JSONL files. See the [Studio documentation](./studio/README.md) for editing, shared schemas, and data sets.

## VS Code extension

The [VS Code extension](./extension/README.md) validates JSONL files in the editor and provides commands for validation and migration. Install it from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode).

## Development

Use the pnpm version specified in `package.json`. Run these commands from the repository root.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

`pnpm build` builds the library and Studio. To build the library alone, run `pnpm --filter lines-db build`. Run the examples with `pnpm example`, `pnpm example:validation`, `pnpm example:json`, or `pnpm example:datadir`.

| Directory     | Contents                                                    |
| ------------- | ----------------------------------------------------------- |
| `lib/`        | `lines-db`, including the database API and CLI              |
| `studio/`     | `@lines-db/studio`, including the local server and built UI |
| `studio-ui/`  | Studio's React source                                       |
| `extension/`  | VS Code extension                                           |
| `tests/unit/` | Integration and type tests                                  |
| `e2e/`        | Studio browser tests                                        |
| `examples/`   | Usage examples                                              |

### Browser tests

Studio's browser tests use [TesterArmy e2e](https://e2e.tester.army). Install Chromium and sign in to ChatGPT before the first local run.

```bash
pnpm e2e:setup
pnpm e2e:deterministic
```

`pnpm e2e` runs all browser tests. `pnpm e2e:agent` runs the agent tests, which use a ChatGPT subscription and run locally. CI runs the scripted tests on pull requests and attaches an HTML report.

To read the latest result or export the HTML report, run:

```bash
pnpm e2e:report
pnpm --filter @toiroakr/lines-db-e2e e2e:report:html
```

The HTML report is written to `e2e/.e2e/report.html`. Screenshots and traces are in `e2e/.e2e/artifacts/`.

### Releases

Add a changeset with `pnpm changeset` for changes to published packages. [Changesets](https://github.com/changesets/changesets) tracks the versions of `lines-db` and `@lines-db/studio`. CI creates a release PR; merging it publishes the packages to npm.

## License

[MIT](./LICENSE)

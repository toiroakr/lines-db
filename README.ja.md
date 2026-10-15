# lines-db

[English](./README.md)

lines-dbはJSONLファイルをSQLiteのテーブルとして読み込むライブラリです。シードデータの検証、テスト用データの検索、変更内容のファイルへの書き戻しに使えます。スキーマにはValibotやZodなど、Standard Schemaに対応したライブラリを使えます。

## 使い始める

Node.js 24.21.0以降が必要です。

```bash
npm install lines-db
```

`data/users.jsonl`に、1行につき1つのJSONオブジェクトを記述します。

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

スキーマの定義、型生成、検索、書き戻しの設定は[ライブラリのドキュメント](./lib/README.ja.md)を参照してください。

## Studio

ブラウザでデータを閲覧・編集するには、`@lines-db/studio`を追加します。

```bash
npm install -D @lines-db/studio
npx lines-db studio ./data --open
```

変更内容は保存するまでファイルに反映されません。保存時にスキーマで検証し、JSONLファイルへ書き込みます。画面の操作、共通スキーマ、データセットの扱いは[Studioのドキュメント](./studio/README.ja.md)にまとめています。

## VS Code拡張

[VS Code拡張](./extension/README.ja.md)はエディタ上でJSONLファイルを検証し、検証やマイグレーションのコマンドを提供します。[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode)からインストールできます。

## 開発

`package.json`に指定したバージョンのpnpmを使います。以下はリポジトリのルートで実行してください。

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

`pnpm build`でライブラリとStudioをビルドします。ライブラリだけなら`pnpm --filter lines-db build`を使います。サンプルは`pnpm example`、`pnpm example:validation`、`pnpm example:json`、`pnpm example:datadir`で実行できます。

| ディレクトリ  | 内容                                                   |
| ------------- | ------------------------------------------------------ |
| `lib/`        | データベースAPIとCLIを含む`lines-db`                   |
| `studio/`     | ローカルサーバーとビルド済みUIを含む`@lines-db/studio` |
| `studio-ui/`  | StudioのReactソース                                    |
| `extension/`  | VS Code拡張                                            |
| `tests/unit/` | 統合テストと型のテスト                                 |
| `e2e/`        | Studioのブラウザテスト                                 |
| `examples/`   | 使用例                                                 |

### ブラウザテスト

Studioのブラウザテストには[TesterArmy e2e](https://e2e.tester.army)を使います。初回はChromiumをインストールし、ChatGPTにログインしてください。

```bash
pnpm e2e:setup
pnpm e2e:deterministic
```

`pnpm e2e`で全ブラウザテスト、`pnpm e2e:agent`でエージェントのテストを実行します。エージェントのテストはChatGPTサブスクリプションを使うため、ローカルで実行します。CIではプルリクエストごとに手順を指定したテストを実行し、HTMLレポートを添付します。

直前の実行結果の表示とHTMLレポートの出力には、以下を使います。

```bash
pnpm e2e:report
pnpm --filter @toiroakr/lines-db-e2e e2e:report:html
```

HTMLレポートの出力先は`e2e/.e2e/report.html`です。スクリーンショットとトレースは`e2e/.e2e/artifacts/`にあります。

### リリース

公開パッケージを変更したときは、`pnpm changeset`でchangesetを追加します。[Changesets](https://github.com/changesets/changesets)で`lines-db`と`@lines-db/studio`のバージョンを管理しています。CIが作成するリリースPRをマージすると、npmへ公開されます。

## ライセンス

[MIT](./LICENSE)

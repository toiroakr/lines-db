# LinesDB for VS Code

[English](./README.md)

[lines-db](https://github.com/toiroakr/lines-db/tree/main/lib#readme)を使ってJSONLファイルを検証するVS Code拡張です。レコード数やスキーマ情報を表示し、検証とマイグレーションのコマンドを提供します。

## セットアップ

VS Code 1.134.0以降が必要です。ワークスペースのプロジェクトに`lines-db`をインストールしてください。ライブラリにはNode.js 22.12.0以降が必要です。

```bash
npm install lines-db
```

データディレクトリにJSONLファイルとスキーマを置きます。

```text
data/
  users.jsonl
  users.schema.ts
  products.jsonl
  products.schema.ts
```

既定のデータディレクトリは`./data`です。別の場所を使う場合は、ワークスペース設定の`lines-db.dataDir`を変更します。

## 検証とスキーマ情報

JSONLファイルを開くと、エディタに検証エラーを表示します。エラーには対象のフィールドと理由を示します。データディレクトリ全体を検証するには、コマンドパレットから**LinesDB: Validate Files**を実行してください。

JSONLファイルの先頭にあるCodeLensでレコード数を確認し、検証を実行できます。`.schema.ts`ファイルの`schema`のexportにカーソルを合わせると、テーブル名、対応するファイル、レコード数、検証結果を表示します。

大きなファイルでは検証に時間がかかることがあります。

## マイグレーション

JSONLファイルを開き、コマンドパレットから**LinesDB: Migrate Data**を実行します。以下のような変換関数を入力してください。

```js
(row) => ({ ...row, updated: true });
```

変更する行を絞るフィルターも指定できます。

```js
{
  age: (age) => age > 25;
}
```

コマンドパレットはmacOSではCmd+Shift+P、WindowsとLinuxではCtrl+Shift+Pで開きます。

## 設定

VS Codeの設定で「LinesDB」を検索してください。

| 設定                         | 内容                                      | 既定値   |
| ---------------------------- | ----------------------------------------- | -------- |
| `lines-db.dataDir`           | JSONLファイルとスキーマを置くディレクトリ | `./data` |
| `lines-db.enableDiagnostics` | 編集中に検証エラーを表示する              | `true`   |

## 開発

リポジトリのルートで実行します。

```bash
pnpm install
pnpm --filter lines-db-vscode build
```

`pnpm --filter lines-db-vscode watch`で変更時に再ビルドします。動作を確認するには、VS Codeで`extension`フォルダーを開き、F5でExtension Development Hostを起動してください。

## リリースノート

[CHANGELOG.md](./CHANGELOG.md)を参照してください。

## ライセンス

[MIT](../LICENSE)

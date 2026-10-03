# lines-db

[日本語版 README](./README.ja.md) | [English README](./README.md)

JSONLファイルをテーブルとして扱う軽量なデータベース実装です。SQLiteを使用し、アプリケーションのシードデータ管理やテストに最適です。

## 機能

- 📝 JSONLファイルをデータベーステーブルとして読み込み
- 🔄 自動スキーマ推論
- 💾 インメモリまたはファイルベースのSQLiteストレージ
- 🚀 フルSQLクエリサポート
- 🔍 シンプルなクエリAPI
- 📦 **JSON型カラムサポート** - 自動シリアライズ/デシリアライズ
- ✅ StandardSchemaによる組み込みバリデーション（Valibot、Zodなど対応）
- 🎯 **テーブル名からの自動型推論**（型引数不要！）
- 🔄 **双方向スキーマ変換**とバックワード変換の自動適用
- 💾 **JSONLファイルへの自動同期** - データベースの変更をファイルに永続化
- 🛡️ TypeScriptによる型安全性
- 🧪 最小限の依存関係（Node.jsの組み込みSQLiteを使用）

## クイックスタート

```bash
npm install @toiroakr/lines-db
```

```typescript
import { LinesDB } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

const users = db.find('users');
await db.close();
```

**完全なドキュメントは [lib/README.ja.md](./lib/README.ja.md) をご覧ください**

## リポジトリ構成

このリポジトリはモノレポとして構成されています：

```
lines-db/
├── lib/                 # コアライブラリパッケージ（@toiroakr/lines-db）
│   ├── src/            # ソースコード
│   ├── dist/           # ビルド出力（ESM）
│   ├── bin/            # CLI実行ファイル
│   └── README.ja.md    # 📚 ユーザー向けドキュメント（npmに公開）
├── tests/              # 統合テスト
│   └── unit/          # ユニットテスト
├── examples/           # 使用例
└── extension/          # VSCode拡張
```

## パッケージ

### 📦 コアライブラリ: [@toiroakr/lines-db](./lib)

データベース機能を提供するメインのnpmパッケージです。

**[→ 完全なドキュメント](./lib/README.ja.md)**

**機能:**

- JSONLファイルの読み込みとパース
- SQLiteデータベース抽象化
- スキーマ推論とバリデーション
- 型安全なクエリAPI
- Node.js 22.12+サポート
- バリデーションと型生成のためのCLIツール
- ブラウザでテーブルを閲覧・編集できる UI（`lines-db studio`）

### 🔌 VSCode拡張: [lines-db-vscode](./extension)

リアルタイムバリデーションと開発ツールを備えたlines-db用のVSCode拡張機能です。

**[→ 拡張機能のドキュメント](./extension/README.md)**

**機能:**

- コマンドパレット統合（検証、マイグレーション）
- リアルタイムバリデーション診断
- レコード数を表示するCodeLens
- スキーマファイルのホバー情報
- JSONLシンタックスハイライト

## 開発

### 前提条件

- Node.js 22.12.0以降
- pnpm 10.x以降

### セットアップ

```bash
# 依存関係のインストール
pnpm install

# ライブラリのビルド
cd lib
pnpm run build
```

### テスト

```bash
# ユニットテストを実行
pnpm test
```

studio の E2E テストは `e2e/` にあり、[TesterArmy e2e](https://e2e.tester.army) で実行します。手順を書いたテスト（`pnpm e2e:deterministic`）は、プルリクエストごとに CI で実行し、レポートを、そのままブラウザで開ける HTML 1枚（`studio-e2e-report.html`）の artifact としてアップロードして、プルリクエストにコメントします。手元では `pnpm e2e:report:html` で同じファイルを `e2e/.e2e/report.html` に書き出せます。AI エージェントのテストは ChatGPT サブスクリプション経由でブラウザを操作するため、CI では実行せずローカルで実行します。

```bash
# 初回のみ: テスト用の Chromium をインストールし、ChatGPT にログイン
pnpm e2e:setup

# ビルドしてから、全テスト・手順を書いたテストのみ・AI エージェントのテストのみを実行
pnpm e2e
pnpm e2e:deterministic
pnpm e2e:agent

# 最後に実行したテストの結果を表示（スクリーンショットと trace は e2e/.e2e/artifacts/ にある）
pnpm e2e:report
```

### その他のコマンド

```bash
# 型チェック
pnpm typecheck

# リント
pnpm lint
pnpm lint:fix

# フォーマット
pnpm format
pnpm format:check

# サンプル実行
pnpm example
pnpm example:validation
pnpm example:json
pnpm example:datadir
```

## コントリビューション

コントリビューションを歓迎します！プルリクエストをお気軽に送信してください。

### ワークフロー

1. リポジトリをフォーク
2. フィーチャーブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add some amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. プルリクエストを開く

### 公開

このプロジェクトは [changesets](https://github.com/changesets/changesets) を使用してバージョン管理を行っています：

```bash
# changesetを作成
pnpm changeset

# パッケージのバージョンアップ
pnpm version

# npmに公開
pnpm release
```

## ライセンス

MIT

## リンク

- **npm**: [@toiroakr/lines-db](https://www.npmjs.com/package/@toiroakr/lines-db)
- **GitHub**: [toiroakr/lines-db](https://github.com/toiroakr/lines-db)
- **Issues**: [github.com/toiroakr/lines-db/issues](https://github.com/toiroakr/lines-db/issues)
- **ドキュメント**: [lib/README.ja.md](./lib/README.ja.md)
- **拡張機能**: [extension/README.md](./extension/README.md)

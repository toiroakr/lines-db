# lines-db

JSONLファイルをテーブルとして扱うデータ管理ライブラリです。アプリケーションのシードデータ管理やテストに最適です。

## 機能

- 📝 JSONLファイルをデータベーステーブルとして読み込み
- ✅ **バリデーションとデータマイグレーションのためのCLIツール**
- 🔄 自動スキーマ推論
- 📦 **JSON型カラムサポート** - 自動シリアライズ/デシリアライズ
- ✅ StandardSchemaによる組み込みバリデーション（Valibot、Zodなど対応）
- 🎯 **テーブル名からの自動型推論**
- 🔄 **双方向スキーマ変換**
- 💾 **JSONLファイルへの自動同期**
- 🛡️ TypeScriptによる型安全性
- 🌐 **マルチランタイムサポート** - Node.js (22.5+)、Bun、Deno

## VS Code拡張機能

JSONLファイルのシンタックスハイライトとバリデーションをサポートするVS Code拡張機能が利用可能です。

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/toiroakr.lines-db-vscode?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode)

[VS Code Marketplaceからインストール](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode)

## インストール

```bash
npm install @toiroakr/lines-db
# または
pnpm add @toiroakr/lines-db
```

## CLI の使い方

### スキーマの設定

JSONLファイルと同じ場所にスキーマファイルを作成します：

**ディレクトリ構造：**

```
data/
  ├── users.jsonl
  ├── users.schema.ts
  ├── products.jsonl
  └── products.schema.ts
```

**スキーマの例（users.schema.ts）：**

```typescript
import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';

export const schema = defineSchema(
  v.object({
    id: v.pipe(v.number(), v.integer(), v.minValue(1)),
    name: v.pipe(v.string(), v.minLength(1)),
    age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
    email: v.pipe(v.string(), v.email()),
  }),
);
export default schema;
```

**サポートされているバリデーションライブラリ：**

- [StandardSchema](https://standardschema.dev/)を実装する任意のライブラリ

### JSONL ファイルのバリデーション

JSONLファイルをスキーマに対してバリデーションします：

```bash
npx lines-db validate <path>
```

**例：**

```bash
# ./dataディレクトリ内の全JSONLファイルをバリデーション
npx lines-db validate ./data

# 特定のファイルをバリデーション
npx lines-db validate ./data/users.jsonl

# 詳細出力
npx lines-db validate ./data --verbose
```

このコマンドは以下を実行します：

- ディレクトリの場合：ディレクトリ内の全ての `.jsonl` ファイルを検索
- ファイルの場合：指定された `.jsonl` ファイルをバリデーション
- 対応する `.schema.ts` ファイルを読み込み
- 各レコードをスキーマに対してバリデーション
- 詳細なメッセージとともにバリデーションエラーを報告

### データのマイグレーション

バリデーション付きでJSONLファイルのデータを変換します：

```bash
npx lines-db migrate <file> <transform> [options]
```

**例：**

```bash
# 全ての年齢に1を加算
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })"

# フィルター付きでマイグレーション
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, active: true })" --filter "{ age: (age) => age > 18 }"

# エラー時に変換後のデータを保存
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })" --errorOutput ./migrated.jsonl
```

**オプション：**

- `--filter, -f <expr>` - 行を選択するフィルター式
- `--errorOutput, -e <path>` - マイグレーション失敗時に変換後のデータを保存するファイルパス
- `--verbose, -v` - 詳細なエラーメッセージを表示

マイグレーションはトランザクション内で実行され、コミット前に全ての変換後の行がバリデーションされます。

## TypeScript での使い方

### 型の生成

スキーマから型安全なデータベースアクセスのためのTypeScript型を生成します：

```bash
npx lines-db generate <dataDir>
```

**例：**

```bash
# 型を生成（デフォルトで ./data/db.ts を作成）
npx lines-db generate ./data
```

**package.jsonに追加：**

```json
"scripts": {
  "db:validate": "lines-db validate ./data",
  "db:generate": "lines-db generate ./data"
}
```

### クイックスタート

**1. JSONLファイルを作成（./data/users.jsonl）：**

```jsonl
{"id":1,"name":"Alice","age":30,"email":"alice@example.com"}
{"id":2,"name":"Bob","age":25,"email":"bob@example.com"}
{"id":3,"name":"Charlie","age":35,"email":"charlie@example.com"}
```

**2. TypeScriptで使用：**

```typescript
import { LinesDB } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// 全てのユーザーを検索
const users = db.find('users');
console.log(users); // [{ id: 1, name: "Alice", ... }, ...]

// 特定のユーザーを検索
const user = db.findOne('users', { id: 1 });
console.log(user); // { id: 1, name: "Alice", age: 30, ... }

// 条件付きで検索
const adults = db.find('users', { age: (age) => age >= 30 });

await db.close();
```

### 生成された型の使用

`npx lines-db generate ./data` を実行後：

```typescript
import { LinesDB } from '@toiroakr/lines-db';
import { config } from './data/db.js';

const db = LinesDB.create(config);
await db.initialize();

// ✨ 型は自動的に推論されます！
const users = db.find('users');

// ✨ 型安全な操作
db.insert('users', {
  id: 10,
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
});

await db.close();
```

### コア API

**クエリ操作：**

- `find(table, where?)` - 一致する全てのレコードを検索
- `findOne(table, where?)` - 単一のレコードを検索
- `query(sql, params?)` - 生のSQLクエリを実行

**変更操作：**

- `insert(table, data)` - 単一のレコードを挿入
- `update(table, data, where)` - 一致するレコードを更新
- `delete(table, where)` - 一致するレコードを削除

**バッチ操作：**

- `batchInsert(table, data[])` - 複数のレコードを挿入
- `batchUpdate(table, updates[])` - 複数のレコードを更新
- `batchDelete(table, where)` - 複数のレコードを削除

**トランザクションとスキーマ：**

- `transaction(fn)` - トランザクション内で操作を実行
- `getSchema(table)` - テーブルスキーマを取得
- `getTableNames()` - 全てのテーブル名を取得

**WHERE条件：**

```typescript
// シンプルな等価条件
db.find('users', { age: 30 });

// 複数条件（AND）
db.find('users', { age: 30, name: 'Alice' });

// 高度な条件
db.find('users', {
  age: (age) => age > 25,
  name: (name) => name.startsWith('A'),
});
```

### JSON型カラム

オブジェクトと配列は自動的にJSON型カラムとして処理されます：

```typescript
db.insert('orders', {
  id: 1,
  items: [{ name: 'Laptop', quantity: 1 }],
  metadata: { source: 'web' },
});

const order = db.findOne('orders', { id: 1 });
console.log(order.items[0].name); // "Laptop"
```

### スキーマ変換

スキーマがデータ型を変換する場合（例：日付文字列をDateオブジェクトに変換）、データをJSONLファイルに保存し直すためのバックワード変換を提供する必要があります。

**なぜ必要？** JSONLファイルは`"2024-01-01"`のような文字列を保存しますが、アプリケーションは`Date`オブジェクトで動作します。双方向の変換が必要です。

**例：**

```typescript
import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';

const eventSchema = v.pipe(
  v.object({
    id: v.number(),
    // 変換：string → Date（読み込み時）
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

// バックワード変換を提供：Date → string（書き込み時）
export const schema = defineSchema(eventSchema, (output) => ({
  ...output,
  date: output.date.toISOString(), // DateをStringに変換
}));
```

**JSONLファイル内（events.jsonl）：**

```jsonl
{
  "id": 1,
  "date": "2024-01-01T00:00:00.000Z"
}
```

**TypeScriptコード内：**

```typescript
const event = db.findOne('events', { id: 1 });
console.log(event.date instanceof Date); // true
console.log(event.date.getFullYear()); // 2024
```

### トランザクション

トランザクション外の操作は自動的に同期されます：

```typescript
db.insert('users', { id: 10, name: 'Alice', age: 30 });
// ↑ 自動的に users.jsonl に同期
```

トランザクションでのバッチ操作：

```typescript
await db.transaction(async (tx) => {
  tx.insert('users', { id: 10, name: 'Alice', age: 30 });
  tx.update('users', { age: 31 }, { id: 1 });
  // コミット時に全ての変更がアトミックに同期
});
```

## 設定

```typescript
interface DatabaseConfig {
  dataDir: string; // JSONLファイルが含まれるディレクトリ
}

const db = LinesDB.create({ dataDir: './data' });
```

## 型マッピング

| JSON型               | カラム型 | SQLiteストレージ |
| -------------------- | -------- | ---------------- |
| number（整数）       | INTEGER  | INTEGER          |
| number（浮動小数点） | REAL     | REAL             |
| string               | TEXT     | TEXT             |
| boolean              | INTEGER  | INTEGER          |
| object               | JSON     | TEXT             |
| array                | JSON     | TEXT             |

## ライセンス

MIT

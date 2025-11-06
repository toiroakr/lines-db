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
import type { InferOutput } from '@toiroakr/lines-db';

const userSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
  email: v.pipe(v.string(), v.email()),
});

export const schema = defineSchema(userSchema);
export type User = InferOutput<typeof schema>;
export default schema;
```

**サポートされているバリデーションライブラリ：**

- Valibot
- Zod（StandardSchemaサポート付き）
- Yup（StandardSchemaサポート付き）
- [StandardSchema](https://standardschema.dev/)を実装する任意のライブラリ

### JSONL ファイルのバリデーション

JSONLファイルをスキーマに対してバリデーションします：

```bash
npx lines-db validate <dataDir>
```

**例：**

```bash
# ./dataディレクトリ内の全JSONLファイルをバリデーション
npx lines-db validate ./data

# 詳細出力
npx lines-db validate ./data --verbose
```

このコマンドは以下を実行します：

- ディレクトリ内の全ての `.jsonl` ファイルを検索
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

```typescript
import { LinesDB } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

const users = db.find('users');
const user = db.findOne('users', { id: 1 });

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

クエリ: `find()`, `findOne()`, `query()` | 変更: `insert()`, `update()`, `delete()` | バッチ: `batchInsert()`, `batchUpdate()`, `batchDelete()` | トランザクション: `transaction()` | スキーマ: `getSchema()`, `getTableNames()`

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

変換を含むスキーマ（例：string → Date）の場合、バックワード変換を提供します：

```typescript
import * as v from 'valibot';
import { defineSchema } from '@toiroakr/lines-db';

const eventSchema = v.pipe(
  v.object({
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

export const schema = defineSchema(eventSchema, (output) => ({
  ...output,
  date: output.date.toISOString(), // DateをStringに変換
}));
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

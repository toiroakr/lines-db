# lines-db

JSONLファイルをテーブルとして扱う軽量なデータベース実装です。SQLiteを使用し、アプリケーションのシードデータ管理やテストに最適です。

[日本語版 README](./README.ja.md) | [English README](./README.md)

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
- 🧪 最小限の依存関係（各ランタイムの組み込みSQLiteを使用）
- 🌐 **マルチランタイムサポート** - Node.js、Bun、Denoで動作

## 要件

lines-dbは以下のJavaScriptランタイムで動作します：

- **Node.js** 22.5.0以降（`node:sqlite`使用）
- **Bun** 1.0以降（`bun:sqlite`使用）
- **Deno** 2.0以降（`node:sqlite`互換レイヤー使用）

## ランタイムサポート

lines-dbは複数のJavaScriptランタイムで動作します：

| ランタイム | ESM | CommonJS | SQLiteモジュール | 状態         |
| ---------- | --- | -------- | ---------------- | ------------ |
| Node.js    | ✅  | ✅       | `node:sqlite`    | 完全サポート |
| Bun        | ✅  | ✅       | `bun:sqlite`     | 完全サポート |
| Deno       | ✅  | N/A      | `node:sqlite`    | 完全サポート |

lines-dbは実行時にランタイムを自動検出し、適切なSQLiteモジュールを使用します。

## インストール

```bash
npm install lines-db
# または
pnpm add lines-db
# または
yarn add lines-db
```

## 使い方

### クイックスタート

JSONLファイルが含まれているディレクトリを指定するだけです：

```typescript
import { LinesDB } from 'lines-db';

// JSONLファイルが含まれているディレクトリを指定するだけ
const db = LinesDB.create({
  dataDir: './data',
});

// すべてのJSONLファイルとスキーマが自動的に検出されます！
await db.initialize();

// データをクエリ
const users = db.selectAll('users');
const user = db.findOne('users', { id: 1 });
const activeUsers = db.find('users', { active: true });

// カスタムSQLを実行
const results = db.query('SELECT * FROM users WHERE age > ?', [25]);

// 終了時にクローズ（autoSync対応のため非同期）
await db.close();
```

**ディレクトリ構造：**

```
data/
  ├── users.jsonl
  ├── users.schema.ts      (オプション - バリデーション用)
  ├── products.jsonl
  ├── products.schema.ts   (オプション - バリデーション用)
  └── orders.jsonl
      orders.schema.ts     (オプション - バリデーション用)
```

### 自動型推論

スキーマファイルからTypeScriptの型を生成して、自動型推論を有効にします：

```bash
# 型を生成（./data/db.ts を作成）
npx lines-db generate --dataDir ./data

# または package.json scripts に追加
"scripts": {
  "generate:types": "lines-db generate --dataDir ./data"
}
```

#### CLIのランタイム対応

CLIは全てのサポート対象ランタイムで動作します：

**Node.js:**

```bash
npx lines-db validate ./data
npx lines-db generate --dataDir ./data
```

**Bun:**

```bash
bunx lines-db validate ./data
bunx lines-db generate --dataDir ./data
```

**Deno:**

```bash
deno run --allow-read --allow-write --allow-env --allow-sys npm:lines-db validate ./data
deno run --allow-read --allow-write --allow-env --allow-sys npm:lines-db generate --dataDir ./data
```

#### 生成された型の使用方法

コマンドを実行すると、データディレクトリに `db.ts` ファイルが生成されます。生成された `config` をインポートすることで、自動型推論が有効になります：

```typescript
import { LinesDB } from 'lines-db';
import { config } from './data/db.js'; // 生成されたconfigをインポート

// 型付きconfigを使用
const db = LinesDB.create(config);
await db.initialize();

// ✨ 型は自動的に User[] として推論されます！
const users = db.selectAll('users');

// ✨ 型は自動的に Product | null として推論されます
const product = db.findOne('products', { id: 1 });

// ✨ 型安全な挿入 - TypeScriptがエラーを検出！
db.insert('users', {
  id: 10,
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
});

// ❌ TypeScriptエラー - 無効なフィールド！
// db.insert('users', { invalid: 'field' });

await db.close();
```

生成された `db.ts` ファイルは、アプリケーション全体で使用できる、推論されたテーブル型を持つ型安全な設定を提供します。

### JSONLファイル形式

1行に1つのJSONオブジェクトを記述します：

**users.jsonl**

```jsonl
{"id": 1, "name": "Alice", "age": 30, "email": "alice@example.com"}
{"id": 2, "name": "Bob", "age": 25, "email": "bob@example.com"}
{"id": 3, "name": "Charlie", "age": 35, "email": "charlie@example.com"}
```

**products.jsonl**

```jsonl
{"id": 1, "name": "Laptop", "price": 999.99, "inStock": true}
{"id": 2, "name": "Mouse", "price": 29.99, "inStock": true}
{"id": 3, "name": "Keyboard", "price": 79.99, "inStock": false}
```

**orders.jsonl**（JSON型カラムを含む）

```jsonl
{"id": 1, "customerId": 100, "items": [{"name": "Laptop", "quantity": 1, "price": 999.99}], "metadata": {"source": "web"}}
{"id": 2, "customerId": 101, "items": [{"name": "Mouse", "quantity": 2, "price": 29.99}], "metadata": {"source": "mobile"}}
```

## JSON型カラムの使用

lines-dbはJSON型カラム（オブジェクトと配列）を自動的にシリアライズ/デシリアライズして処理します。

### JSON型カラムの例

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({
  tables: new Map([
    [
      'orders',
      {
        jsonlPath: './data/orders.jsonl',
        autoInferSchema: true,
      },
    ],
  ]),
});

await db.initialize();

// JSON型カラムを含む注文を挿入
db.insert('orders', {
  id: 10,
  customerId: 200,
  items: [
    { name: 'Monitor', quantity: 1, price: 299.99 },
    { name: 'Keyboard', quantity: 1, price: 79.99 },
  ],
  metadata: {
    source: 'api',
    campaign: 'spring2024',
    tags: ['bulk', 'priority'],
  },
});

// 注文を読み込み - JSON型カラムは自動的にデシリアライズされる
interface Order {
  id: number;
  customerId: number;
  items: Array<{ name: string; quantity: number; price: number }>;
  metadata: Record<string, any>;
}

const order = db.findOne<Order>('orders', { id: 10 });
console.log(order.items[0].name); // "Monitor"
console.log(order.metadata.source); // "api"
```

### JSON型カラムのバリデーション

**orders.schema.ts**

```typescript
import * as v from 'valibot';

export const schema = v.object({
  id: v.pipe(v.number(), v.integer()),
  customerId: v.pipe(v.number(), v.integer()),
  items: v.array(
    v.object({
      name: v.string(),
      quantity: v.pipe(v.number(), v.integer(), v.minValue(0)),
      price: v.pipe(v.number(), v.minValue(0)),
    }),
  ),
  metadata: v.nullable(v.record(v.string(), v.any())),
});
```

## StandardSchemaによるバリデーション

lines-dbは[StandardSchema](https://standardschema.dev/)を使用したバリデーションをサポートしており、Valibot、Zod、Yupなどの人気のバリデーションライブラリと互換性があります。

### バリデーションの設定

JSONLファイルと同じ名前のスキーマファイルを作成します：

**users.schema.ts**（`users.jsonl`用）

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferOutput } from 'lines-db';

const userSchema = v.object({
  id: v.pipe(v.number(), v.integer(), v.minValue(1)),
  name: v.pipe(v.string(), v.minLength(1)),
  age: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(150)),
  email: v.pipe(v.string(), v.email()),
});

// defineSchemaでラップしてBiDirectionalSchemaを作成
// Input = Outputのため、バックワード変換は不要
export const schema = defineSchema(userSchema);

// StandardSchemaを使用してスキーマから型を推論してエクスポート
export type User = InferOutput<typeof schema>;

export default schema;
```

スキーマはデータベース初期化時に自動的に読み込まれます。バリデーションは以下のタイミングで適用されます：

- `insert()` / `batchInsert()` の実行時
- `batchUpdate()`（`{ validate: false }`を指定しない限り）
- JSONLファイルからの初期データ読み込み

**注意：** `update()` は既存レコードとのマージ後にバリデーションをスキップして部分更新を許可します。複数行を個別の値で更新しながら検証したい場合は `batchUpdate()` を利用してください。

### スキーマから型を使用する

スキーマファイルから推論された型をインポートできます。型推論はStandardSchemaの型システムを使用しているため、StandardSchema互換のライブラリ（Valibot、Zodなど）で動作します：

```typescript
import { LinesDB } from 'lines-db';
import type { User } from './data/users.schema.ts';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// スキーマから推論された型を使用
const users = db.selectAll<User>('users');
const user = db.findOne<User>('users', { id: 1 });
```

`InferOutput`型ヘルパーは、任意のStandardSchemaからoutput型を抽出し、特定のバリデーションライブラリの実装に依存せずに型安全性を提供します。

### バリデーションの例

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({
  tables: new Map([
    [
      'users',
      {
        jsonlPath: './data/users.jsonl',
        autoInferSchema: true,
      },
    ],
  ]),
});

await db.initialize();

// ✅ 有効な挿入
db.insert('users', {
  id: 10,
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
});

// ❌ 無効な挿入 - ValidationErrorがスローされる
try {
  db.insert('users', {
    id: 11,
    name: '', // 空の名前は許可されない
    age: -5, // 負の年齢は許可されない
    email: 'not-an-email', // 無効なメールアドレス
  });
} catch (error) {
  if (error.name === 'ValidationError') {
    console.log('Validation errors:', error.issues);
  }
}
```

### 双方向スキーマ変換

スキーマが変換を実行する場合（Input ≠ Output）、JSONL永続化のためにバックワード変換を提供する必要があります：

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';
import type { InferInput, InferOutput } from 'lines-db';

// 変換を含むスキーマ: string -> Date
const eventSchema = v.pipe(
  v.object({
    id: v.number(),
    name: v.string(),
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

// バックワード変換を定義: Date -> string
export const schema = defineSchema(eventSchema, (output) => ({
  ...output,
  date: output.date.toISOString(), // DateをStringに変換
}));

export type EventInput = InferInput<typeof schema>; // { date: string }
export type EventOutput = InferOutput<typeof schema>; // { date: Date }

export default schema;
```

バックワード変換は以下の場合に必須です：

- **変更の永続化**: 出力型を入力型に変換してJSONLファイルに保存
- **データ整合性**: データが正しくシリアライズ可能であることを保証

**注意:** Input = Output（変換なし）の場合、バックワード変換は不要です。

## JSONLファイルへの変更の永続化

lines-dbは、データベースの変更をJSONLファイルに永続化する2つの方法を提供します：

### 1. 自動同期（トランザクション外）

トランザクション外の操作は自動的にJSONLファイルに同期されます：

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// これらの操作は即座にJSONLファイルに同期されます
db.insert('users', { id: 10, name: 'Alice', age: 30, email: 'alice@example.com' });
db.update('users', { age: 31 }, { id: 1 });
db.delete('users', { id: 3 });
// 上記の各操作は自動的にusers.jsonlファイルを更新します

await db.close();
```

バッチ系ヘルパーである `batchInsert()`, `batchUpdate()`, `batchDelete()` も、トランザクション外では同様に自動同期されます。

### 2. トランザクション

トランザクションを使用して、複数の操作をバッチ処理し、アトミックに同期できます：

```typescript
import { LinesDB } from 'lines-db';

const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// トランザクション: 変更はバッチ処理され、コミット時に同期されます
await db.transaction(async (tx) => {
  tx.insert('users', { id: 10, name: 'Alice', age: 30, email: 'alice@example.com' });
  tx.update('users', { age: 31 }, { id: 1 });
  tx.delete('users', { id: 3 });
  // トランザクションがコミットされると、すべての変更がJSONLファイルに同期されます
});

// エラーが発生した場合、変更はロールバックされ、同期されません
await db.transaction(async (tx) => {
  tx.insert('users', { id: 11, name: 'Bob', age: 25, email: 'bob@example.com' });
  throw new Error('Something went wrong');
  // トランザクションは自動的にロールバックされ、JSONLファイルへの変更はありません
});

await db.close();
```

### 手動同期

すべてのテーブルをJSONLファイルに手動で同期することもできます：

```typescript
const db = LinesDB.create({ dataDir: './data' });
await db.initialize();

// execute()や生のSQLを使用して変更を加える
db.execute('INSERT INTO users (id, name) VALUES (?, ?)', [12, 'Charlie']);

// すべてのテーブルを手動で同期
await db.sync();

await db.close();
```

### 同期の仕組み

**同期プロセス:**

1. SQLiteテーブルからすべての行を読み込む
2. スキーマでバックワード変換が定義されている場合、それを適用（Output → Input）
3. すべての行をJSONLファイルに書き込み、既存の内容を上書き
4. 1行に1つのJSONオブジェクトという形式が維持されます

**同期が発生するタイミング:**

- **自動同期**: トランザクション外での各`insert()`, `batchInsert()`, `update()`, `batchUpdate()`, `delete()`, `batchDelete()` の後
- **トランザクション**: `transaction()`が正常にコミットされたとき
- **手動**: `sync()`メソッドを明示的に呼び出したとき

**重要な注意点:**

- 同期時には、スキーマのバックワード変換が使用されます（Output → Input）
- テーブル内のすべての行がJSONLファイルに書き戻されます（完全上書き、増分ではない）
- 同期操作はテーブルごとに独立して実行されます
- 大量のデータの場合、テーブル全体が書き直されるため同期操作に時間がかかる可能性があります
- パフォーマンス向上のため、複数の操作をバッチ処理するにはトランザクションを使用してください

## APIリファレンス

### コンストラクタ

```typescript
LinesDB.create(config: DatabaseConfig, dbPath?: string)
```

- `config`: テーブル定義を含むデータベース設定
- `dbPath`: SQLiteデータベースファイルへのパス（オプション、デフォルトは`:memory:`）

### メソッド

#### `initialize(): Promise<void>`

すべてのJSONLファイルを読み込み、テーブルを作成します。

```typescript
await db.initialize();
```

#### `selectAll<T>(tableName: string): T[]`

テーブルからすべての行を取得します。

```typescript
interface User {
  id: number;
  name: string;
  age: number;
}

const users = db.selectAll<User>('users');
```

#### `find<T>(tableName: string, where: Record<string, unknown>): T[]`

条件で行を検索します。

```typescript
const results = db.find('users', { age: 30, active: true });
```

#### `findOne<T>(tableName: string, where: Record<string, unknown>): T | null`

条件で単一の行を検索します。

```typescript
const user = db.findOne('users', { id: 1 });
```

#### `query<T>(sql: string, params?: any[]): T[]`

カスタムSQLクエリを実行します。

```typescript
const results = db.query('SELECT * FROM users WHERE age > ?', [25]);
```

#### `queryOne<T>(sql: string, params?: any[]): T | null`

クエリを実行して単一の行を返します。

```typescript
const result = db.queryOne('SELECT COUNT(*) as count FROM users');
```

#### `execute(sql: string, params?: any[]): { changes: number | bigint; lastInsertRowid: number | bigint }`

INSERT、UPDATE、DELETE文を実行します（バリデーションなし）。

```typescript
db.execute('INSERT INTO users (name, age) VALUES (?, ?)', ['David', 40]);
db.execute('UPDATE users SET age = ? WHERE id = ?', [31, 1]);
db.execute('DELETE FROM users WHERE id = ?', [3]);
```

#### `insert(tableName: string, data: Record<string, unknown>): { changes: number | bigint; lastInsertRowid: number | bigint }`

バリデーション付きで行を挿入します。

```typescript
db.insert('users', {
  id: 10,
  name: 'Eve',
  age: 28,
  email: 'eve@example.com',
});
```

#### `batchInsert(tableName: string, records: Record<string, unknown>[]): { changes: number | bigint; lastInsertRowid: number | bigint }`

複数の行をまとめて挿入します。各レコードに対してバリデーションが行われます。

```typescript
db.batchInsert('users', [
  { id: 11, name: 'Mallory', age: 22 },
  { id: 12, name: 'Oscar', age: 27 },
]);
```

#### `update(tableName: string, data: Record<string, unknown>, where: Record<string, unknown>): { changes: number | bigint; lastInsertRowid: number | bigint }`

行を更新します（部分更新のためバリデーションはスキップされます）。

```typescript
db.update('users', { age: 31 }, { id: 1 });
```

#### `batchUpdate(tableName: string, records: Array<Record<string, unknown>>, options?: { validate?: boolean }): { changes: number | bigint; lastInsertRowid: number | bigint }`

主キーを含む複数レコードをまとめて更新します。各レコードには対象行を特定するための主キーが必要で、デフォルトではバリデーションが行われます。

```typescript
db.batchUpdate(
  'users',
  [
    { id: 1, age: 31 },
    { id: 2, age: 27 },
  ],
  { validate: true },
);
```

#### `delete(tableName: string, where: Record<string, unknown>): { changes: number | bigint; lastInsertRowid: number | bigint }`

テーブルから行を削除します。

```typescript
db.delete('users', { id: 3 });
```

#### `batchDelete(tableName: string, records: Array<Record<string, unknown>>): { changes: number | bigint; lastInsertRowid: number | bigint }`

主キーを指定して複数の行をまとめて削除します。各レコードに主キー値が含まれている必要があります。

```typescript
db.batchDelete('users', [{ id: 3 }, { id: 4 }]);
```

#### `getSchema(tableName: string): TableSchema | undefined`

テーブルのスキーマを取得します。

```typescript
const schema = db.getSchema('users');
console.log(schema);
```

#### `getTableNames(): string[]`

すべてのテーブル名を取得します。

```typescript
const tables = db.getTableNames();
```

#### `sync(): Promise<void>`

データベースの変更を手動でJSONLファイルに同期します。

```typescript
await db.sync();
```

**注意:** スキーマからバックワード変換が利用可能な場合に使用されます。

#### `transaction<T>(fn: (tx: LinesDB) => Promise<T> | T): Promise<T>`

トランザクション内で関数を実行します。成功時は自動的にコミット、エラー時は自動的にロールバックします。

```typescript
await db.transaction(async (tx) => {
  tx.insert('users', { id: 10, name: 'Alice', age: 30 });
  tx.update('users', { age: 31 }, { id: 1 });
  tx.delete('users', { id: 3 });
  // すべての変更はコミット時にJSONLファイルに同期されます
});
```

**パラメータ:**

- `fn`: トランザクション内で実行する関数。データベースインスタンスをパラメータとして受け取ります。

**戻り値:** 提供された関数の戻り値。

**動作:**

- `BEGIN TRANSACTION`でSQLiteトランザクションを開始
- 提供された関数を実行
- 成功時: `COMMIT`でコミットし、すべてのテーブルをJSONLファイルに同期
- エラー時: `ROLLBACK`でロールバックし、エラーを再スロー
- ネストされたトランザクションはサポートされていません

#### `close(): Promise<void>`

データベース接続を閉じます。

```typescript
await db.close();
```

## 設定

### DatabaseConfig

```typescript
interface DatabaseConfig {
  dataDir: string; // JSONLファイルが含まれるディレクトリ
}
```

**例：**

```typescript
const db = LinesDB.create({
  dataDir: './data', // すべての.jsonlファイルを自動的に検出
});
```

### TableConfig

```typescript
interface TableConfig {
  jsonlPath: string; // JSONLファイルへのパス
  schema?: TableSchema; // オプション：手動SQLiteスキーマ
  autoInferSchema?: boolean; // 自動スキーマ推論（デフォルト：true）
  validationSchema?: StandardSchema; // オプション：バリデーションスキーマ
}
```

### バリデーションスキーマファイル

スキーマファイルは`${テーブル名}.schema.ts`という名前で、JSONLファイルと同じディレクトリ（または`schemaDir`で指定したディレクトリ）に配置する必要があります。

**サポートされているバリデーションライブラリ：**

- Valibot
- Zod（StandardSchemaサポート付き）
- Yup（StandardSchemaサポート付き）
- StandardSchemaを実装する任意のライブラリ

### 手動スキーマ定義

自動推論の代わりに手動でスキーマを定義できます：

```typescript
const config = {
  tables: new Map([
    [
      'users',
      {
        jsonlPath: './data/users.jsonl',
        schema: {
          name: 'users',
          columns: [
            { name: 'id', type: 'INTEGER', primaryKey: true, notNull: true },
            { name: 'name', type: 'TEXT', notNull: true },
            { name: 'age', type: 'INTEGER' },
            { name: 'email', type: 'TEXT', unique: true },
          ],
        },
      },
    ],
  ]),
};
```

## 型マッピング

| JSON型               | カラム型 | SQLiteストレージ | 備考                                         |
| -------------------- | -------- | ---------------- | -------------------------------------------- |
| number（整数）       | INTEGER  | INTEGER          | 整数                                         |
| number（浮動小数点） | REAL     | REAL             | 小数                                         |
| string               | TEXT     | TEXT             | 文字列                                       |
| boolean              | INTEGER  | INTEGER          | falseは0、trueは1                            |
| null                 | NULL     | NULL             | null値                                       |
| object               | JSON     | TEXT             | JSON文字列として保存、読み込み時に自動パース |
| array                | JSON     | TEXT             | JSON文字列として保存、読み込み時に自動パース |

### JSON型カラム

オブジェクトと配列は自動的に`JSON`型カラムとして推論されます。これらは：

- SQLiteにJSON文字列として保存（TEXT型）
- データ挿入時に自動シリアライズ
- `selectAll()`、`find()`、`findOne()`を使用した読み込み時に自動デシリアライズ

**注意：** `query()`や`queryOne()`を使用した生のSQLクエリでは、JSON型カラムは文字列として返されます。自動デシリアライズにはテーブル固有のメソッドを使用してください。

## 開発

```bash
# 依存関係のインストール
pnpm install

# ビルド
pnpm run build

# テストの実行
pnpm test              # ユニットテスト
pnpm test:runtime      # 全ランタイムテスト（Node.js, Deno, Bun）
pnpm test:cjs          # CommonJS（Node.js）テスト
pnpm test:deno         # Denoテスト
pnpm test:bun          # Bunテスト
pnpm test:all          # 全テスト
```

### ランタイムテスト

lines-dbは、共通のテストスイートを使用して3つのランタイムでテストされています：

- **Node.js (CommonJS)**: `tests/runtime-cjs/` - CommonJSモジュールシステムのテスト
- **Deno**: `tests/runtime-deno/` - Denoランタイムのテスト
- **Bun**: `tests/runtime-bun/` - Bunランタイムのテスト

各ランタイムテストは、`tests/shared/test-suite.ts`にある共通のテストスイート（16テストケース）を実行します。

## ライセンス

MIT

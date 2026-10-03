# lines-db

JSONLファイルをテーブルとして扱うデータ管理ライブラリです。アプリケーションのシードデータ管理やテストに最適です。

## 機能

- 📝 JSONLファイルをデータベーステーブルとして読み込み
- ✅ **バリデーションとデータマイグレーションのためのCLIツール**
- 🖥️ **ブラウザでテーブルを閲覧・編集できる UI**（`lines-db studio`）
- 🔄 自動スキーマ推論
- 📦 **JSON型カラムサポート** - 自動シリアライズ/デシリアライズ
- ✅ StandardSchemaによる組み込みバリデーション（Valibot、Zodなど対応）
- 🎯 **テーブル名からの自動型推論**
- 🔄 **双方向スキーマ変換**
- 💾 **JSONLファイルへの自動同期**
- 🛡️ TypeScriptによる型安全性
- Node.js 22.5+サポート

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

スキーマファイルを読み込めない（import に失敗する、または `schema` か `default` として Standard Schema を
export していない）テーブルがあると、`initialize()` はそのファイルと理由を示して失敗します。検証なしで
テーブルを読み込むことはしません。

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

# 他のフィールドを書き換えずに id だけを後入れする
npx lines-db migrate ./data "(row) => ({ ...row, id: row.id ?? crypto.randomUUID() })" --fields id
```

**オプション：**

- `--filter, -f <expr>` - 行を選択するフィルター式
- `--fields <list>` - 書き戻すフィールドをカンマ区切りで指定。指定外のフィールドは JSONL ファイルの元の値がそのまま保たれる（デフォルト：全フィールドを書き戻す）
- `--errorOutput, -e <path>` - マイグレーション失敗時に変換後のデータを保存するファイルパス
- `--verbose, -v` - 詳細なエラーメッセージを表示

マイグレーションはトランザクション内で実行され、コミット前に全ての変換後の行がバリデーションされます。

#### 一部のフィールドだけを書き戻す

デフォルトではマイグレーションは各行を丸ごと書き戻すため、バリデーションスキーマが計算した値や
JSONL ファイルで省略されていたフィールドまでファイルに実体化されてしまいます。`--fields` を使うと
書き戻しを指定したフィールドだけに絞り込み、行のそれ以外の内容は元のまま保たれます：

```bash
# 実行前の users.jsonl: {"name":"John"}
npx lines-db migrate ./data/users.jsonl "(row) => row" --fields id
# 実行後の users.jsonl: {"id":"...","name":"John"}
```

行と元の行との対応付けは主キーで行い、ファイルにまだ主キーが無い場合（主キー自体を後入れする
ケース）は行の位置で対応付けます。行の並び順はファイルのものが保たれ、ファイルに存在しなかった行は
保持すべき内容が無いため末尾に丸ごと追加されます。ファイルに使える主キーが無く、かつ行数が
変わっている場合は対応付けができないため、推測せずにエラーになります。

指定したリストはマイグレーション対象の全テーブルに適用されます。そのフィールドを持たないテーブルには
何も書き戻されないため、`id` を持つテーブルと持たないテーブルが混在するディレクトリでも
`--fields id` 一つで動きます。どのテーブルにも無いフィールド名はtypoとみなしてエラーになります。

### 足りない値を埋める

```bash
npx lines-db fill <path> [--fields id,createdAt]
```

`path`（データディレクトリ、またはその中の `.jsonl` ファイル1つ）の JSONL のうち、指定したフィールド
（省略時は各テーブルの主キー）に値が無い行へ、そのテーブルの検証スキーマが行に与える値を埋めます。ファイルに
既にある値は置き換えず、値が入らなかった行は改行コードも含めて1バイトも変えません。値が入った行は、
スキーマが並べる順にキーを並べて書き直します。すべての値を計算してからファイルに書き、スキーマが弾く行には
何も入りません。読み込んだ後に別のツールが保存したファイルがあると、どのファイルにも書かずに、そのファイル名を
持つ `JsonlConflictError` で止まります。
フィールドはファイル上の名前で指定します。`backward` で主キーの名前を変えるスキーマでは、省略時に使う主キーは
データベース側の名前なので、ファイル側のフィールド名を `--fields` で指定してください。

コードからは `fillFields()` で同じことができます。行の値を計算する関数も渡せるので、レコード作成時の値を
検証スキーマ以外から得るテーブルにも使えます：

```typescript
import { fillFields, unwrap } from '@toiroakr/lines-db';

const { filled } = unwrap(
  await fillFields({
    path: './data',
    fields: ['id'],
    // スキーマファイルが export する `hook` で値を計算する。例外を投げると何も書かずに止まる
    loadFiller: (schemaModule, { schemaPath }) => {
      if (typeof schemaModule.hook !== 'function') throw new Error(`${schemaPath} does not export \`hook\``);
      return schemaModule.hook;
    },
  }),
);
```

結果には、スキーマファイルの無いテーブル（`tablesWithoutSchema`）、JSON オブジェクトとして読めない行
（`unreadableLines`）、どのテーブルも値を出さなかったフィールド（`unproducedFields`）も含まれます。

### ブラウザで閲覧・編集する

```bash
npx lines-db studio <dataDir> [--port 4848] [--open] [--write-filled-values primaryKey|all]
```

`http://127.0.0.1:4848` でローカルの Web UI を起動します。`dataDir` のテーブルを行数つきで一覧表示し、
テーブルを表形式で表示します。セルを押して編集するほか、表の横の行フォームで1行をまとめて編集し、
列ごとの入力欄が並ぶダイアログで行を追加し、行を選んで削除できます。変更は表の中で色分けされた
未保存の状態で残り、**Save N changes** を押すと、`db.update()` / `db.insert()` / `db.delete()` を通して
1つのトランザクションでまとめて書き込まれます。**Discard** で破棄できます。スキーマが受け付けない値があると
何も書き込まれず、どの変更で弾かれたかとその issue が表示され、未保存の変更は直せるように残ります。
保存で値が変わるのは編集した行だけですが、テーブルの JSONL ファイルは全体を書き直すため、
ほかの行の書式（空白など）も変わることがあります。

- サーバーは起動ごとにトークンを作って返すページに渡し、ページはそれを `sessionStorage` に保存してリクエスト
  ごとに送ります。トークンを持たないリクエストは 401 で断ります。ほかのサイトは studio のページを読めないので、
  トークンも手に入りません。
- 保存では、自分で書いたフィールドだけをファイルに書き、スキーマが補う値は書きません（`writeFilledValues: 'primaryKey'`。
  [スキーマが補う値](#スキーマが補う値)参照）。`--write-filled-values all` を指定すると、同期のデフォルトと同じく補った値も書きます。
- ファイルではなくスキーマが補った値は、薄い文字に **default** の印を付けて表示します。セルの編集欄の
  **Remove field** を押すと、そのフィールドをファイルの行から消して値をスキーマに任せます。行の追加で空のままにした
  フィールドもスキーマに任せます。**Remove field** と **Set null** は、スキーマが受け付ける場合にだけ表示します。
  どちらを受け付けるかは、サンプルの行を1つ取り、そのフィールドを消した行と null にした行を検証して調べます。
  JSON の値の中では、キーを足した行と消した行を検証して調べます。
- セルの編集欄は、入力中の値を保存時と同じようにスキーマで検証し（書き込まずに検証だけする
  `POST /api/tables/:name/check` を使います）、そのフィールドの issue を欄の下に表示します。JSON の値は、
  中身をフォームとして編集します。オブジェクトはキーごとの入力欄、配列は項目ごとの入力欄、オブジェクトの配列は
  項目ごとのブロックになり、issue はその対象のキーの下に表示します。各ブロックはシンタックスハイライト付きの
  JSON エディタに切り替えられ、構文エラーはその位置に印が付きます。コメントとケツカンマ（閉じ括弧の直前のカンマ）も
  書けますが、値は通常の JSON として保存するため、**Set** の時点で取り除きます。テキストの欄は行数に合わせて
  高さが伸び、Shift+Enter で改行できます。**Set**（Enter、JSON では Cmd/Ctrl+Enter）は値を未保存の変更に加えるだけで、
  保存するまでファイルには書き込みません。
- 行フォームは、ヘッダー右端のボタンで表の横に表示し、1行のフィールドをまとめて編集します。変更は未保存の変更に
  加わります。表示している間は、行をクリックするとその行をフォームに出し、ダブルクリックでセルを編集します。
  隠している間は、行をダブルクリックするとフォームを表示してその行を出します。外部キーのフィールドからは
  参照先の行を開けます。フォームの端をドラッグすると幅を変えられます。
- **Add record** を押すと、主キーを含む列ごとの入力欄が並ぶダイアログが開きます。空のままにしたフィールドは
  行に含めず、入力中の行はまとめて検証します。
- ヘッダーのボタンで、配色を OS の設定・ライト・ダークに切り替えられます。
- **Schema** を押すと、まずテーブルの宣言（列、外部キー、インデックス）を表示します。列は、スキーマファイルの型（Standard Schema の `types`）を、プロジェクトに入っている TypeScript で読んで出します。TypeScript 5・6 は Compiler API、7.1 以降は Corsa API を使い、各列に型と、省略できるか（optional）・null になりうるか（nullable）を示します。TypeScript がない場合や、スキーマが型を宣言していない場合は、行の値から推測した列を出し、その旨を画面に示します。外部キーは参照先テーブルのスキーマへのリンクで、開いているスキーマはアドレス（`#orders?schema=customers`）に表れます。**Code** タブには、スキーマファイル（`<table>.schema.ts` など）の中身をそのままハイライト付きで表示します。検証に失敗する行があるテーブルは、コードだけを表示します。
- 編集できるのは主キー（`id` 列、またはスキーマファイルの `primaryKey`）を持ち、全行に主キーの値があるテーブルです。主キーの
  ないテーブルは読み取り専用で表示されます。
- 読み込み時に検証エラーになった行を含むテーブルは、JSONL ファイルの中身のまま表示し、エラーの行とセルに印を
  付けてその内容を出します。セルを直して保存すると、`validateRow()` でスキーマに照らして確かめたうえで、その行の
  1行だけを書き換えます（ほかの行はそのまま）。すべての行が通ると、テーブルは通常どおり読み込まれます。それまでは
  行の追加と削除はできません。スキーマがキーとして受け付けないフィールドには **not in schema** の印が付き、列見出しの
  ボタンでそのフィールドを全行からまとめて消せます。
- studio を開いている間にディスク上のファイルが変わると、ページが自動で行を読み直します（未保存の変更が
  あるときは、その旨を表示します）。保存の前にファイルを確かめ、スキーマファイルが変わっていれば読み直して
  新しいスキーマで検証します。編集しているテーブルの JSONL が変わっていれば、そのファイル名を示して何も書かずに
  止まり、テーブルを読み直します。保存で書き戻すのは、編集したテーブルと、そこから外部キーのアクション
  （`CASCADE` や `SET NULL`）で変わりうるテーブルです。そのため、これらのファイルが変わっていても止まります。
  関係のないテーブルのファイルが変わっていても止まりません。
- サーバーはローカルホスト宛てのリクエストにだけ応答し、書き込みは自身のページから `application/json`
  で送られたものだけを受け付けます。

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
import { LinesDB, unwrap } from '@toiroakr/lines-db';

const db = LinesDB.create({ dataDir: './data' });
unwrap(await db.initialize());

// 全てのユーザーを検索
const users = unwrap(db.find('users'));
console.log(users); // [{ id: 1, name: "Alice", ... }, ...]

// 特定のユーザーを検索
const user = unwrap(db.findOne('users', { id: 1 }));
console.log(user); // { id: 1, name: "Alice", age: 30, ... }

// 条件付きで検索
const adults = unwrap(db.find('users', { age: (age) => age >= 30 }));

unwrap(await db.close());
```

> `LinesDB`/`JsonlReader` のほとんどのメソッドは例外を投げる代わりに `Result<T, Error>` を返します。
> 詳細は後述の[エラーハンドリング](#エラーハンドリング)を参照してください。`unwrap()` は値を取り出すか、
> エラーがあれば投げ直すユーティリティで、スクリプトの冒頭など投げ直して構わない場面で便利ですが、
> `Result` を扱う唯一の方法ではありません。

### 生成された型の使用

`npx lines-db generate ./data` を実行後：

```typescript
import { LinesDB, unwrap } from '@toiroakr/lines-db';
import { config } from './data/db.js';

const db = LinesDB.create(config);
unwrap(await db.initialize());

// ✨ 型は自動的に推論されます！
const users = unwrap(db.find('users'));

// ✨ 型安全な操作
unwrap(
  db.insert('users', {
    id: 10,
    name: 'Alice',
    age: 30,
    email: 'alice@example.com',
  }),
);

unwrap(await db.close());
```

## エラーハンドリング

`LinesDB` と `JsonlReader` の、失敗しうるメソッドは例外を投げる代わりに `Result<T, Error>`
（`{ ok: true; value: T } | { ok: false; error: Error }` という判別共用体）を返します。
`getSchema`・`getTableNames`・`getDb` は失敗しないため、これらは従来通り値をそのまま返します。

```typescript
const result = db.insert('users', { id: 2, name: '' }); // バリデーションスキーマに違反

if (result.ok) {
  console.log(result.value.changes);
} else {
  console.log(result.error.message);
}
```

`unwrap(result)` は `result.value` を返すか、`result.ok` が `false` のとき `result.error` を投げます。
スクリプトの冒頭や、失敗を例外のように伝播させたい場面で使うと便利です：

```typescript
import { unwrap } from '@toiroakr/lines-db';

const users = unwrap(db.find('users')); // db.find() がエラーを返した場合は投げる
```

`db.transaction(async (tx) => { ... })` の中では、`tx` は `db` と同じくResultを返すAPIです。
`tx.insert()`/`tx.update()` 等が失敗しても、それ自体では例外を投げないためトランザクションは
自動的にロールバックされません。ロールバックさせたい場合はResultを確認して `throw result.error`
するか、`unwrap` を呼んでください。コールバック内で例外が投げられたときだけロールバックされます。

コールバックの中では `db` ではなく `tx` で書き込んでください。トランザクションの実行中に `db` 自体を通した書き込み
（コールバックが await している間に動く別のコードなど）は、トランザクションと一緒にコミットまたはロールバックされて
しまうため、拒否されます。トランザクションの実行中に `db`（`getDb()`・`execute()`・`query()`）で実行できる SQL は
読み取りだけです。`SELECT`・`VALUES`・`WITH`・`EXPLAIN`、`PRAGMA table_info(...)` のように読むだけの PRAGMA が通り、
トランザクション制御や値を設定する `PRAGMA` を含む、それ以外は拒否されます。それらは `tx` を通して実行してください。

### コア API

以下の操作は特に断りがない限り `Result<T, Error>` を返します。`getSchema`・`getTableNames`・`getDb`
は失敗しないため、値をそのまま返します。

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
- `sync(table?, options?)` - 変更を JSONL ファイルに書き戻す
- `getSchema(table)` - テーブルスキーマを取得（`TableSchema | undefined` を返す。`Result` ではない）
- `validateRow(table, row)` - 行をテーブルのスキーマで検証する。検証エラーで読み込まれなかったテーブルにも使える（`Result<JsonObject, ValidationError>` を返す）
- `getTableNames()` - 全てのテーブル名を取得（`string[]` を返す。`Result` ではない）

**WHERE条件：**

```typescript
// シンプルな等価条件
unwrap(db.find('users', { age: 30 }));

// 複数条件（AND）
unwrap(db.find('users', { age: 30, name: 'Alice' }));

// 高度な条件
unwrap(
  db.find('users', {
    age: (age) => age > 25,
    name: (name) => name.startsWith('A'),
  }),
);
```

### JSON型カラム

オブジェクトと配列は自動的にJSON型カラムとして処理されます：

```typescript
unwrap(
  db.insert('orders', {
    id: 1,
    items: [{ name: 'Laptop', quantity: 1 }],
    metadata: { source: 'web' },
  }),
);

const order = unwrap(db.findOne('orders', { id: 1 }));
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
const event = unwrap(db.findOne('events', { id: 1 }));
console.log(event.date instanceof Date); // true
console.log(event.date.getFullYear()); // 2024
```

### トランザクション

トランザクション外の操作は自動的に同期されます：

```typescript
unwrap(db.insert('users', { id: 10, name: 'Alice', age: 30 }));
// ↑ 自動的に users.jsonl に同期
```

同期はファイルの行順を維持し、ファイルに無かった行は末尾に追加します。差分が実際に変わった箇所だけに
留まるようになっています。

トランザクションでのバッチ操作：

```typescript
unwrap(
  await db.transaction(async (tx) => {
    unwrap(tx.insert('users', { id: 10, name: 'Alice', age: 30 }));
    unwrap(tx.update('users', { age: 31 }, { id: 1 }));
    // まとめて書き戻してからコミット
  }),
);
```

コールバック内で `unwrap()` を使うと、`tx.insert()`/`tx.update()` の失敗が例外として投げられ、
`transaction()` がそれを捕捉してロールバックします（[エラーハンドリング](#エラーハンドリング)参照）。

コールバックが終わると、`transaction()` はコミットの前に、`tx.insert()`/`tx.update()`/`tx.delete()` と
それぞれの batch 版で変更したテーブルを書き戻します。1つ目のファイルを書く前にすべてのファイルを照合し、
書き戻しに失敗したらトランザクションをロールバックし、書き終えたファイルを元の内容に戻すので、データベースと
ファイルの内容がずれません。元に戻すのも書き込みなので、それも失敗した場合はそのファイルに変更が残ります。
変更していないテーブルのファイルには触れません。`tx.execute()` や `tx.query()` の生の SQL で行を変更した場合は、どのテーブルを
変更したか分からないため、全テーブルを書き戻します。コールバックの中で `sync()` を呼ぶとエラーになります。
ファイルへの書き込みは、コールバックが終わった後でトランザクション自身が行うためです。

### 読み込み後に変更されたファイル

データベースは、`initialize()` が読んだ時点と、自分が最後に書き込んだ時点の各 JSONL ファイルの内容を覚えています。
書き戻しのときにファイルがそれ以降に変更されていた場合（エディタで行を追加した、値を手で書き換えた、ファイルを
削除した など）、その変更を上書きせずにファイルをそのまま残し、ファイル名を持つ `JsonlConflictError` で失敗します。

```typescript
const result = await db.transaction((tx) => unwrap(tx.update('users', { age: 31 }, { id: 1 })));

if (!result.ok && result.error.name === 'JsonlConflictError') {
  console.log(`${(result.error as JsonlConflictError).file} がディスク上で変更されています`);
}
```

変更を取り込むには、データベースを作り直して `initialize()` を呼び、書き込みをやり直してください。失敗した
`transaction()` は変更をロールバック済みで、書き戻すのは変更したテーブルだけなので、失敗するのはそれらの
ファイルが変更されていた場合だけです。`sync()` とトランザクション外の書き込みの後の自動同期にはロールバック
するものがなく、ファイルに反映されなかった変更がデータベースに残ります。テーブル名を指定しない `sync()` は
全テーブルを書き戻すので、どれか1つのテーブルのファイルが変更されていても失敗します。自動同期のエラーは
`console.error` に出力されます。

照合は書き込みの直前に行い、照合から書き込みまでの間はロックを取りません。そのため、そのごく短い間に
エディタや同じファイルに書き込む別プロセスが保存した変更は、上書きされます。この照合は、一人がローカルで
ファイルを編集する使い方を想定しており、その使い方ではこの間に変更が入ることはまずありません。

書き込む前に確かめるには `hasExternalChanges()` を使います。データベースが最後に読んだ／書き込んだ後に、
JSONL ファイルが変更・追加・削除されたか、テーブルのスキーマファイルが変更・追加・削除されたかを返します。
`findExternalChanges()` は変わったファイルの一覧を返すので、外部の編集がどのテーブルに及んだかを見分けられます。
長く動き続けるプロセスでは、別のツールがファイルを書き換えたときに読み直すのに使えます。

```typescript
if (unwrap(await db.hasExternalChanges())) {
  await db.close();
  db = LinesDB.create(config);
  unwrap(await db.initialize());
}
```

### スキーマが補う値

同期はデフォルトで各行を丸ごと書き戻すため、バリデーションスキーマが補う値（既定値や、スキーマが計算する
フィールド）も行に書かれます。`writeFilledValues: 'primaryKey'` を指定すると、ユーザーが書いたフィールドだけを
書き戻します。行がファイルで持っているフィールド、`insert()` に渡したフィールド、`update()` で値が変わった
フィールドがこれにあたります。それ以外のスキーマが補う値はファイルに書かれず、行はその値をスキーマに任せた
ままになります。スキーマが生成した主キーは書き込みます。次に読み込んだときも同じ主キーにするためです。

```typescript
const db = LinesDB.create({ dataDir: './data', writeFilledValues: 'primaryKey' });
// people.jsonl: {"id":1,"name":"Alice"}   （スキーマは age の既定値を 20 にする）
unwrap(await db.transaction((tx) => unwrap(tx.update('people', { name: 'Alicia' }, { id: 1 }))));
// people.jsonl: {"id":1,"name":"Alicia"}  （age はスキーマに任せたまま）
```

1回の同期だけ切り替えるには `sync(tableName, { writeFilledValues })` を使います。フィールドを今と同じ値に
設定するのは変更ではないため、スキーマが補ったフィールドをその値に設定しても行には書かれません。
`writeBackFields` や `sync(..., { fields })` で指定したフィールドは、スキーマが補った値でも書き込みます。

行が持っているフィールドをスキーマに任せ直すには、既定値に戻します。行はスキーマが補う値を持ち、
`writeFilledValues: 'primaryKey'` のときはファイルの行からそのフィールドが消えます：

```typescript
unwrap(db.update('people', {}, { id: 1 }, { resetToDefault: ['age'] }));
```

`findWithDefaults()` は、各行と、その行でスキーマが補ったフィールド（ファイルに書かれていないフィールド）の
一覧を返します。ファイルに書かれた値と見分けて表示するのに使えます：

```typescript
unwrap(await db.findWithDefaults('people'));
// [{ row: { id: 1, name: 'Alicia', age: 20 }, defaulted: ['age'] }]
```

backward 変換がフィールド名を変える行、ファイルの行も書き込みの記録も無い行（生の SQL で追加した行）、
`execute()` や `query()` の生の SQL で行が変わった後のテーブルの全行は、どのフィールドをユーザーが書いたか
分からないため、全フィールドを書き戻します。読み込み時に移行用の `transform` が設定したフィールドは、
その行でユーザーが書いたフィールドとして扱います。

テーブルに列の無いフィールド（valibot の `v.object()` のように未知のキーを取り除くだけのスキーマでは、
そのような行も検証を通ります）は、書き戻しでも行の中の元の位置に残します。未知のキーを含む行を
検証エラーにしたい場合は、`v.strictObject()` のように未知のキーを拒むスキーマを使ってください。

### 一部のフィールドだけを書き戻す

書き戻すフィールドを指定すると、そのフィールドはスキーマが補った値であってもデータベースの値が書かれ、
行のそれ以外の内容はファイルの元の値がそのまま保たれます：

```typescript
// users.jsonl: {"name":"Alice"}
unwrap(await db.sync('users', { fields: ['id'] }));
// users.jsonl: {"id":"...","name":"Alice"}
```

設定の `writeBackFields` に指定すると、insert・update・トランザクション後の自動同期を含む全ての
同期に同じルールが適用されます：

```typescript
const db = LinesDB.create({ dataDir: './data', writeBackFields: ['id'] });
```

行と元の行との対応付けは主キーで行い、ファイルにまだ主キーが無い場合（主キー自体を後入れする
ケース）は行の位置で対応付けます。行の並び順はファイルのものが保たれ、ファイルに存在しなかった行は
末尾に追加されます。指定したフィールドは常にデータベースの値が使われ（データベース側が `null` の
場合も含む）、行を対応付けられない場合は推測せずに `sync` がエラーのResultを返します。

行が持っていなかったフィールドは末尾に追加されるのではなく、スキーマがそれを宣言している位置に
挿入されます。後入れした `id` は、手で書いた行と同じように行の先頭に来ます。スキーマが宣言していない
キーは宣言済みのキーより後ろに留まり、行が既に持っていたキーは動きません。

順序はスキーマが計算した行から読み取ります（スキーマが順序を表明しているのはそこだけです）。先に埋める
フィールドが先に並びます。一部の行にしか無いフィールドは、それまでに見たフィールドより後ろに置かれます。
順序を明示したい場合は `mergeFields` の `keyOrder` を使います。

`sync('users', { fields })` はテーブルを一つ名指しするため、そのテーブルに無いフィールドはエラーに
なります。一方、全テーブルを対象とする同期（`sync()` や設定オプション）では、そのフィールドを持たない
テーブルでは単に対象外となるため、フィールド構成が異なるテーブルが混在していても一つのリストで済みます。

### 行を自分で書き換える

`mergeFields` は、書き戻しのマージ処理だけをデータベース抜きで取り出したものです。行と、スキーマが
その行から計算した行を渡すと、指定フィールドを書き込んだ行を返します。値がクエリ以外の場所から来る場合
（id を埋める hook など）に、ファイルを SQLite に載せる意味がないときに使います：

```typescript
import { JsonlReader, JsonlWriter, mergeFields, unwrap } from '@toiroakr/lines-db';

const rows = unwrap(await JsonlReader.read('./data/users.jsonl'));
const filled = rows.map((row) => mergeFields(row, fillIds(row), { fields: ['id'] }));
await JsonlWriter.write('./data/users.jsonl', filled);

// {"name":"Alice"}  ->  {"id":"018f...","name":"Alice"}
```

行の他の部分は読まれも検証もされないため、スキーマなら弾かれる形式のフィールドがあっても、指定した
フィールドの書き込みは妨げられません。計算した行が値を持たないフィールドは null で潰さずそのまま残し、
計算した行のキー順がスキーマの宣言順と違う場合は `keyOrder` で挿入位置を指定できます。

## 設定

```typescript
interface DatabaseConfig {
  dataDir: string | readonly string[]; // JSONLファイルが含まれるディレクトリ（複数指定可）
  schemaDir?: string; // スキーマファイルが含まれるディレクトリ（デフォルト：各JSONLファイルと同じディレクトリ）
  writeBackFields?: readonly string[]; // 同期時に書き戻すフィールド（デフォルト：全フィールド）
}

const db = LinesDB.create({ dataDir: './data' });
```

### データセット

シードデータを、どの環境でも必要な `base` セットと、特定のシナリオだけが読み込むセットに分けて、
組み合わせて検証できます：

```
data/
  Item.schema.ts   Item.jsonl              # スキーマ + base セット
  ItemValuation.schema.ts
  cogs/
    Item.jsonl                             # Item の追加行（スキーマは置かない）
    ItemValuation.jsonl                    # 両方のセットの Item 行を参照する
```

```typescript
const db = LinesDB.create({ dataDir: ['./data', './data/cogs'], schemaDir: './data' });
const result = unwrap(await db.initialize({ detailedValidate: true }));
```

複数のディレクトリにあるテーブルは、`dataDir` に並べた順に各ファイルの行を連結したものになります。
バリデーション・ユニークインデックス・外部キーは連結後の行全体に対して行われるため、
`cogs/ItemValuation.jsonl` から `data/Item.jsonl` の `Item` を参照でき、両方のセットで同じ id を
定義すると違反として報告されます。エラーはいずれも、その行を読み込んだファイルとそのファイル内の行を指します。

`dataDir` に複数のディレクトリを指定する場合、`schemaDir` は必須です。データセットのディレクトリには
テーブルのスキーマが置かれていないため、指定しないとそれらのテーブルが検証されないまま読み込まれてしまいます。
`schemaDir` は単一ディレクトリでも使えます（`{ dataDir: './data/cogs', schemaDir: './data' }`）。
単一ディレクトリで指定しない場合、スキーマはJSONLファイルと同じディレクトリから探します。

複数のファイルから組み立てたテーブルの行には書き戻し先のファイルが1つに定まらないため、
`dataDir` に複数のディレクトリを指定したデータベースは読み取り専用になります。`insert` / `update` / `delete`、
それぞれの `batch*` 版、`sync()`、および `execute()` / `query()` で書き込む SQL は、
データベースもファイルも変更せずにエラーを返します。

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

# lines-db

[English](./README.md)

lines-dbはJSONLファイルをSQLiteのテーブルとして読み込むライブラリです。行を検索・更新し、変更を元のファイルへ書き戻せます。シードデータやテスト用データをファイルで管理するときに使えます。

列は行の値から推論します。検証用のスキーマを定義すると、ValibotやZodなどのStandard Schemaライブラリで行を検証でき、TypeScriptの型も生成できます。オブジェクトと配列はJSONカラムとして扱います。読み込み時の変換と、書き戻すための逆変換も定義できます。

CLIには検証、マイグレーション、値の補完、型生成のコマンドがあります。ブラウザで編集するには別パッケージの`@lines-db/studio`を使います。[VS Code拡張](https://marketplace.visualstudio.com/items?itemName=toiroakr.lines-db-vscode)ではエディタ上で検証できます。

## インストール

Node.js 24.21.0以降が必要です。

```bash
npm install lines-db
```

pnpmの場合は`pnpm add lines-db`を使います。

## CLIの使い方

### スキーマの設定

JSONLファイルと同じディレクトリに、テーブル名に対応するスキーマファイルを置きます。

```
data/
  ├── users.jsonl
  ├── users.schema.ts
  ├── products.jsonl
  └── products.schema.ts
```

以下はValibotを使った`users.schema.ts`の例です。Valibotは`npm install valibot`で追加できます。

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';

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

[Standard Schema](https://standardschema.dev/)を実装するライブラリを使えます。

スキーマファイルのimportに失敗した場合や、`schema`または`default`としてStandard Schemaをexportしていない場合は、`initialize()`が失敗します。エラーには該当ファイルと理由を含めます。

### JSONLファイルのバリデーション

指定したファイル、またはディレクトリ内のJSONLファイルをスキーマで検証します。

```bash
npx lines-db validate <path>
```

```bash
npx lines-db validate ./data

npx lines-db validate ./data/users.jsonl

npx lines-db validate ./data --verbose
```

対応するスキーマファイルを読み込み、各行を検証します。検証エラーにはファイル名と詳細を表示します。

#### 名前付きデータセットの検証

共通データとシナリオ別のデータを `lines-db.config.json` に定義できます：

```json
{
  "schemaDir": "./data",
  "base": ["./data"],
  "datasets": {
    "cogs": ["./data/cogs"],
    "sales": ["./data/sales"]
  }
}
```

パスを省略すると、カレントディレクトリの `lines-db.config.json` を読み、`base` だけを検証します。
`--dataset <name>` は `base` に指定したデータセットを追加します。複数回指定すると、その順に各セットを結合します。`--all-datasets` は `base` と全データセットを
一度に結合して検証します。シナリオ間で同じIDを使っている場合、全セットの結合では重複エラーになります。

```bash
npx lines-db validate
npx lines-db validate --dataset cogs
npx lines-db validate --dataset cogs --dataset sales
npx lines-db validate --all-datasets
npx lines-db validate --config ./seed/lines-db.config.json --dataset cogs
```

`--config <path>` で別の設定ファイルを指定できます。`schemaDir`・`base`・`datasets` は必須で、
`base` と各データセットは1つ以上のディレクトリを指定します（追加セットが無ければ `datasets: {}`）。
設定内の相対パスは設定ファイルの場所が基準です。ディレクトリは `base`、選択したセットの順に読み込み、
同じディレクトリは1回だけ読み込みます。サブディレクトリを自動で探索することはありません。
スキーマ・ユニーク制約・外部キーは結合したデータ全体に対して検証され、エラーは元のファイルを指します。

`--dataset` と `--all-datasets` の併用、または設定用オプションと位置引数のパスの併用はエラーです。
不明なセット名や不正な設定もエラーになります。既存の `validate <path>` は設定ファイルを使わず、従来どおり動作します。
設定ファイルを使うCLIコマンドは `validate` のみです。

プログラムからは同じ設定を `loadDatasetConfig()` で読み込めます：

```typescript
import { LinesDB, loadDatasetConfig } from 'lines-db';

const config = await loadDatasetConfig('./lines-db.config.json', {
  datasets: ['cogs', 'sales'],
});
const db = LinesDB.create(config);
```

`datasets` の省略または `[]` はbaseのみ、配列はbase＋指定セットを配列順に結合し、`'all'` はbase＋全セットを
設定ファイルの定義順に結合します。同じディレクトリは、シンボリックリンク経由の指定も含めて1回だけ読み込みます。
引数を省略した `loadDatasetConfig()` は、カレントディレクトリの `lines-db.config.json` を読みます。
戻り値は `Promise<DatabaseConfig>` です。設定ファイルを読み込めない場合、不正な設定や未知のセット名がある場合、
または選択したデータディレクトリが存在しない場合はPromiseをrejectします。データの読み込み・検証は
`db.initialize()` で実行します。`schemaDir` が存在しない、またはファイルを指す場合もエラーになります。

### データのマイグレーション

JSONLファイルの各行に変換関数を適用し、結果をスキーマで検証して保存します。

```bash
npx lines-db migrate <file> <transform> [options]
```

```bash
npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })"

npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, active: true })" --filter "{ age: (age) => age > 18 }"

npx lines-db migrate ./data/users.jsonl "(row) => ({ ...row, age: row.age + 1 })" --errorOutput ./migrated.jsonl

npx lines-db migrate ./data "(row) => row" --fields id
```

利用できるオプションは以下のとおりです。

- `--filter, -f <expr>` - 行を選択するフィルター式
- `--fields <list>` - 書き戻すフィールドをカンマ区切りで指定。指定外のフィールドはJSONLファイルの元の値がそのまま保たれる。省略時は全フィールドを書き戻す
- `--errorOutput, -e <path>` - マイグレーション失敗時に変換後のデータを保存するファイルパス
- `--verbose, -v` - 詳細なエラーメッセージを表示

マイグレーションはトランザクション内で実行され、コミット前にすべての変換後の行がバリデーションされます。

#### 一部のフィールドだけを書き戻す

通常のマイグレーションは行全体を書き戻します。スキーマが補った既定値や、省略していたフィールドもファイルに保存されます。`--fields`でフィールドを指定すると、それ以外の値は元のまま残せます。

```bash
npx lines-db migrate ./data/users.jsonl "(row) => row" --fields id
```

主キーがあれば、元の行との対応を主キーで判断します。主キーをこれから補う場合など、ファイルに主キーがなければ行の位置を使います。既存の行順は維持し、新しい行は末尾へ追加します。主キーがなく行数も変わっている場合は、対応を判断できないためエラーになります。

`--fields`は対象の全テーブルに適用します。指定したフィールドを持たないテーブルは書き戻さないため、列構成が異なるテーブルにも同じリストを使えます。どのテーブルにもないフィールド名を指定するとエラーになります。

### 足りない値を埋める

```bash
npx lines-db fill <path...> [--schema-dir ./schemas] [--fields id,createdAt]
```

`path`にはデータディレクトリやJSONLファイルを1つ以上指定します。共通スキーマを使う場合は`--schema-dir`で指定してください。省略すると各JSONLファイルと同じディレクトリでスキーマを探します。指定したフィールドに値がない行へ、検証スキーマが補った値を書き込みます。`--fields`を省略すると、各テーブルの主キーが対象です。

既存の値は置き換えません。値を補わなかった行は改行コードも含めて変更せず、補った行のキーはスキーマの順に並べます。検証に失敗する行には書き込みません。全行の値を計算してからファイルへ書き込みます。読み込み後に他のツールがファイルを変更していた場合は、どのファイルにも書き込まず、ファイル名を含む`JsonlConflictError`で終了します。

フィールドはファイル上の名前で指定してください。`backward`で主キーの名前を変える場合、既定の対象はデータベース側の主キーなので、`--fields`でファイル側の名前を指定します。

`fillFields()`には値を計算する関数を渡せます。以下はスキーマファイルがexportする`hook`で値を計算する例です。関数が例外を投げた場合は、何も書き込みません。

```typescript
import { fillFields, unwrap } from 'lines-db';

const { filled } = unwrap(
  await fillFields({
    path: './data',
    fields: ['id'],
    loadFiller: (schemaModule, { schemaPath }) => {
      if (typeof schemaModule.hook !== 'function') throw new Error(`${schemaPath} does not export \`hook\``);
      return schemaModule.hook;
    },
  }),
);
```

結果の`tablesWithoutSchema`にはスキーマがないテーブル、`unreadableLines`にはJSONオブジェクトとして読めない行、`unproducedFields`にはどのテーブルでも値を生成できなかったフィールドが入ります。

`fillFields()`の`path`には文字列か、空でない文字列配列を渡せます。複数パスでも全ファイルの値を計算し、外部変更を確認してから書き込みます。書き込み中に失敗した場合は、先に書き込んだファイルを復元します。重複して指定したファイルは1回だけ処理します。JSONオブジェクトとして読めない行は、従来どおり変更せずに報告します。

```typescript
unwrap(
  await fillFields({
    path: ['./data/dataset-a', './data/dataset-b'],
    schemaDir: './data',
  }),
);
```

### ブラウザで閲覧・編集する

Studioをプロジェクトに追加して起動します。

```bash
npm install -D @lines-db/studio
npx lines-db studio ./data --open
```

既定のURLは`http://127.0.0.1:4848`です。編集内容は保存時にまとめて検証し、JSONLファイルに書き込みます。画面の操作、共通スキーマ、複数ディレクトリの編集は[Studioのドキュメント](https://github.com/toiroakr/lines-db/blob/main/studio/README.ja.md)を参照してください。

## TypeScriptでの使い方

### 型の生成

スキーマからデータベースの設定と型を生成します。既定の出力先は`<dataDir>/db.ts`です。

```bash
npx lines-db generate <dataDir>
```

```bash
npx lines-db generate ./data
```

`package.json`から呼び出す場合は、以下のように指定します。

```json
{
  "scripts": {
    "db:validate": "lines-db validate ./data",
    "db:generate": "lines-db generate ./data"
  }
}
```

### データを読み込む

`data/users.jsonl`を作成します。

```text
{"id":1,"name":"Alice","age":30,"email":"alice@example.com"}
{"id":2,"name":"Bob","age":25,"email":"bob@example.com"}
{"id":3,"name":"Charlie","age":35,"email":"charlie@example.com"}
```

ディレクトリを指定して読み込みます。

```typescript
import { LinesDB, unwrap } from 'lines-db';

const db = LinesDB.create({ dataDir: './data' });
unwrap(await db.initialize());

const users = unwrap(db.find('users'));
console.log(users); // [{ id: 1, name: "Alice", ... }, ...]

const user = unwrap(db.findOne('users', { id: 1 }));
console.log(user); // { id: 1, name: "Alice", age: 30, ... }

const adults = unwrap(db.find('users', { age: (age) => age >= 30 }));

unwrap(await db.close());
```

`unwrap()`は成功した`Result`から値を取り出し、失敗した場合はエラーを投げます。失敗を分岐で処理する方法は[エラーハンドリング](#エラーハンドリング)を参照してください。

### 生成された型の使用

生成した設定を使うと、テーブル名に応じて行の型が推論されます。

```typescript
import { LinesDB, unwrap } from 'lines-db';
import { config } from './data/db.js';

const db = LinesDB.create(config);
unwrap(await db.initialize());

const users = unwrap(db.find('users'));

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

`LinesDB`と`JsonlReader`の失敗しうるメソッドは、`Result<T, Error>`を返します。成功時は`{ ok: true, value }`、失敗時は`{ ok: false, error }`です。`getSchema`、`getTableNames`、`getDb`は値を直接返します。

```typescript
const result = db.insert('users', { id: 2, name: '' });

if (result.ok) {
  console.log(result.value.changes);
} else {
  console.log(result.error.message);
}
```

`unwrap(result)`は成功時の値を返し、失敗時にはエラーを投げます。失敗した時点で処理を中断したい場合に使います。

```typescript
import { unwrap } from 'lines-db';

const users = unwrap(db.find('users'));
```

トランザクション内の`tx`もResultを返します。`insert()`や`update()`が失敗しても、それだけではロールバックされません。失敗時に中止するには、`unwrap()`を使うか、Resultを確認して`throw result.error`でエラーを投げてください。

トランザクション内では`tx`を通して書き込みます。実行中に別のコードが`db`を通して書き込むと、その変更もトランザクションに含まれてしまうため、書き込みを拒否します。`db`の`getDb()`、`execute()`、`query()`で実行できるのは読み取り用SQLだけです。`SELECT`、`VALUES`、`WITH`、`EXPLAIN`、`PRAGMA table_info(...)`などを受け付けます。トランザクション制御や値を設定するPRAGMAは`tx`から実行してください。

## API

以下の操作は特に断りがない限り`Result<T, Error>`を返します。`getSchema`・`getTableNames`・`getDb`は失敗しないため、値をそのまま返します。

### 検索

- `find(table, where?)` - 一致するすべてのレコードを検索
- `findOne(table, where?)` - 単一のレコードを検索
- `query(sql, params?)` - 生のSQLクエリを実行

### 変更

- `insert(table, data)` - 単一のレコードを挿入
- `update(table, data, where)` - 一致するレコードを更新
- `delete(table, where)` - 一致するレコードを削除

### バッチ操作

- `batchInsert(table, data[])` - 複数のレコードを挿入
- `batchUpdate(table, updates[])` - 複数のレコードを更新
- `batchDelete(table, where)` - 複数のレコードを削除

### トランザクションとスキーマ

- `transaction(fn)` - トランザクション内で操作を実行
- `sync(table?, options?)` - 変更をJSONLファイルに書き戻す
- `getSchema(table)` - テーブルスキーマを取得（`TableSchema | undefined`を返す。`Result`ではない）
- `validateRow(table, row)` - 行をテーブルのスキーマで検証する。検証エラーで読み込まれなかったテーブルにも使える（`Result<JsonObject, ValidationError>`を返す）
- `getTableNames()` - すべてのテーブル名を取得（`string[]`を返す。`Result`ではない）

### 検索条件

```typescript
unwrap(db.find('users', { age: 30 }));

unwrap(db.find('users', { age: 30, name: 'Alice' }));

unwrap(
  db.find('users', {
    age: (age) => age > 25,
    name: (name) => name.startsWith('A'),
  }),
);
```

### JSON型カラム

オブジェクトと配列はJSONカラムとして保存され、取得時には元の値に戻ります。

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

読み込み時に日付文字列を`Date`へ変換する場合は、保存時に文字列へ戻す`backward`変換も定義します。JSONLには文字列を保存し、アプリケーションでは`Date`として扱えます。

```typescript
import * as v from 'valibot';
import { defineSchema } from 'lines-db';

const eventSchema = v.pipe(
  v.object({
    id: v.number(),
    date: v.pipe(
      v.string(),
      v.isoDate(),
      v.transform((str) => new Date(str)),
    ),
  }),
);

export const schema = defineSchema(eventSchema, {
  backward: (output) => ({
    ...output,
    date: output.date.toISOString().slice(0, 10),
  }),
});
```

`events.jsonl`には日付を文字列として保存します。

```text
{"id":1,"date":"2024-01-01"}
```

読み込んだ行では`Date`として使えます。

```typescript
const event = unwrap(db.findOne('events', { id: 1 }));
console.log(event.date instanceof Date); // true
console.log(event.date.getFullYear()); // 2024
```

### トランザクション

トランザクション外で変更すると、JSONLファイルへ自動同期します。

```typescript
unwrap(db.insert('users', { id: 10, name: 'Alice', age: 30 }));
```

同期では元の行順を維持し、新しい行は末尾に追加します。

複数の変更をまとめて保存するには、トランザクションを使います。

```typescript
unwrap(
  await db.transaction(async (tx) => {
    unwrap(tx.insert('users', { id: 10, name: 'Alice', age: 30 }));
    unwrap(tx.update('users', { age: 31 }, { id: 1 }));
  }),
);
```

コールバック内で`unwrap()`を使うと、操作の失敗を例外として投げ、トランザクションをロールバックできます。

コールバックの終了後、コミット前に変更したテーブルを書き戻します。対象ファイルをすべて確認してから書き込みを始めます。書き戻しに失敗した場合はトランザクションをロールバックし、書き込み済みのファイルを復元します。復元にも失敗すると、そのファイルには変更が残ります。

変更していないテーブルは書き戻しません。ただし、`tx.execute()`や`tx.query()`のSQLで行を変更した場合は、変更したテーブルを特定できないため全テーブルを書き戻します。コールバック内での`sync()`はエラーになります。書き戻しはトランザクションの終了時に行います。

### 読み込み後に変更されたファイル

読み込み時、または直前の書き込み時のJSONLファイルの内容を記録しています。それ以降にエディタなどでファイルが変更・削除されていると、同期はそのファイルを上書きせず、ファイル名を含む`JsonlConflictError`を返します。

```typescript
const result = await db.transaction((tx) => unwrap(tx.update('users', { age: 31 }, { id: 1 })));

if (!result.ok && result.error.name === 'JsonlConflictError') {
  console.log(`${(result.error as JsonlConflictError).file} がディスク上で変更されています`);
}
```

外部の変更を取り込むには、データベースを作り直して`initialize()`を呼び、書き込みをやり直します。トランザクションは変更したテーブルだけを書き戻し、競合があればデータベースの変更もロールバックします。

`sync()`とトランザクション外の自動同期では、書き戻しに失敗してもデータベース内の変更は残ります。テーブル名を指定しない`sync()`は全テーブルが対象なので、いずれかのファイルが変更されていると失敗します。自動同期のエラーは`console.error`に出力します。

内容の確認と書き込みの間はファイルをロックしません。その間に別のプロセスが保存した変更は上書きされます。一人でローカルファイルを編集する用途を想定しており、同時に書き込むプロセス間の排他制御は行いません。

`hasExternalChanges()`は、最後に読み書きした後のJSONLファイルやスキーマファイルの変更・追加・削除を確認します。`findExternalChanges()`は該当ファイルの一覧を返します。長時間動くプロセスで、他のツールによる変更を検知して読み直すときに使えます。

```typescript
if (unwrap(await db.hasExternalChanges())) {
  await db.close();
  db = LinesDB.create(config);
  unwrap(await db.initialize());
}
```

### スキーマが補う値

通常の同期では行全体を書き戻すため、スキーマの既定値や計算結果も保存します。`writeFilledValues: 'primaryKey'`では、ファイルに記述したフィールド、`insert()`に渡したフィールド、`update()`で値を変えたフィールドを書き戻します。その他の既定値は省略したままにします。生成された主キーは、次の読み込みでも同じ行を識別できるように保存します。

```typescript
const db = LinesDB.create({ dataDir: './data', writeFilledValues: 'primaryKey' });
// people.jsonl: {"id":1,"name":"Alice"}
unwrap(await db.transaction((tx) => unwrap(tx.update('people', { name: 'Alicia' }, { id: 1 }))));
// people.jsonl: {"id":1,"name":"Alicia"}
```

1回の同期だけ設定を変えるには`sync(tableName, { writeFilledValues })`を使います。同じ値の再設定は変更とみなさないため、既定値を同じ値で更新してもファイルには書きません。`writeBackFields`や`sync(..., { fields })`で明示したフィールドは、スキーマが補った値でも書き込みます。

`resetToDefault`で指定したフィールドはスキーマの既定値に戻ります。`writeFilledValues: 'primaryKey'`では、そのフィールドをファイルから削除します。

```typescript
unwrap(db.update('people', {}, { id: 1 }, { resetToDefault: ['age'] }));
```

`findWithDefaults()`は行の値と、スキーマが補ったフィールド名を返します。ファイルに記述した値と既定値を区別するために使えます。

```typescript
unwrap(await db.findWithDefaults('people'));
// [{ row: { id: 1, name: 'Alicia', age: 20 }, defaulted: ['age'] }]
```

`backward`でフィールド名を変える行や、SQLで追加して元の行と書き込み記録がない行は、明示的に指定されたフィールドを判断できないため行全体を書き戻します。SQLで行を変更したテーブルも全行を書き戻します。読み込み時の移行用`transform`で設定したフィールドは、明示的に指定された値として扱います。

元の行にある未知のフィールドは、書き戻し後も元の位置に残します。Valibotの`v.object()`のように未知のキーを取り除くスキーマでは、その行は検証を通ります。未知のキーをエラーにするには`v.strictObject()`などを使ってください。

### 一部のフィールドだけを書き戻す

書き戻すフィールドを指定すると、そのフィールドはスキーマが補った値であってもデータベースの値が書かれ、行のそれ以外の内容はファイルの元の値がそのまま保たれます。

```typescript
// users.jsonl: {"name":"Alice"}
unwrap(await db.sync('users', { fields: ['id'] }));
// users.jsonl: {"id":"...","name":"Alice"}
```

設定の`writeBackFields`に指定すると、insert・update・トランザクション後の自動同期を含むすべての同期に同じルールが適用されます。

```typescript
const db = LinesDB.create({ dataDir: './data', writeBackFields: ['id'] });
```

元の行との対応には主キーを使い、ファイルにまだ主キーがなければ行の位置を使います。行順は維持し、新しい行は末尾に追加します。指定したフィールドはnullも含めてデータベースの値を書き込みます。行を対応付けられない場合は、`sync()`が失敗したResultを返します。

新しいフィールドはスキーマの順に挿入します。たとえば`id`を先頭に定義していれば、後から補った`id`も行の先頭に入ります。既存のキーは移動せず、スキーマにないキーは宣言済みのキーの後ろに残します。

キーの順序はスキーマが生成した行から読み取ります。先に生成されたフィールドを先に並べ、後の行で初めて現れたフィールドはその後ろに置きます。順序を明示するには`mergeFields`の`keyOrder`を使います。

特定のテーブルを指定した`sync()`では、そのテーブルにないフィールドを指定するとエラーになります。全テーブルの同期や設定の`writeBackFields`では、フィールドを持たないテーブルを対象外にします。列構成が異なるテーブルにも同じリストを使えます。

### 行を自分で書き換える

`mergeFields`は、元の行と計算後の行を受け取り、指定したフィールドだけを反映した行を返します。IDを補うhookなど、SQLiteに読み込まずにファイルを編集したい場合に使えます。

```typescript
import { JsonlReader, JsonlWriter, mergeFields, unwrap } from 'lines-db';

const rows = unwrap(await JsonlReader.read('./data/users.jsonl'));
const filled = rows.map((row) => mergeFields(row, fillIds(row), { fields: ['id'] }));
await JsonlWriter.write('./data/users.jsonl', filled);

// {"name":"Alice"}  ->  {"id":"018f...","name":"Alice"}
```

対象外のフィールドは検証しません。その値がスキーマに違反していても、指定したフィールドを更新できます。計算後の行にないフィールドは元の値を残します。計算結果のキー順がスキーマと異なる場合は、`keyOrder`で新しいキーの位置を指定できます。

## 設定

```typescript
interface DatabaseConfig {
  dataDir: string | readonly string[];
  schemaDir?: string;
  writeDataSets?: boolean;
  writeBackFields?: readonly string[];
}

const db = LinesDB.create({ dataDir: './data' });
```

### データセット

共通のシードデータとシナリオ別のデータを分け、必要なディレクトリを組み合わせて読み込めます。

```
data/
  Item.schema.ts   Item.jsonl              # スキーマと基本データ
  ItemValuation.schema.ts
  cogs/
    Item.jsonl                             # 追加のItem行
    ItemValuation.jsonl                    # 両方のデータセットのItem行を参照
```

```typescript
const db = LinesDB.create({ dataDir: ['./data', './data/cogs'], schemaDir: './data' });
const result = unwrap(await db.initialize({ detailedValidate: true }));
```

同じテーブルの行を`dataDir`の順に連結し、その全体に対して検証、一意制約、外部キーの確認を行います。`cogs/ItemValuation.jsonl`から`data/Item.jsonl`の行を参照できます。複数のセットに同じIDがあれば制約違反になります。エラーは元のファイルと、そのファイル内の行を示します。

複数ディレクトリでは、共通スキーマを参照するため`schemaDir`が必須です。単一ディレクトリでも`schemaDir`を指定できます。省略した場合は、JSONLファイルと同じディレクトリでスキーマを探します。

複数ディレクトリのデータベースはデフォルトでは読み取り専用です。`writeDataSets: true`を指定すると、更新・削除を元のファイルへ反映できます。追加時は、設定済みディレクトリを明示します。

```typescript
const db = LinesDB.create({ dataDir: ['./data', './data/cogs'], schemaDir: './data', writeDataSets: true });
unwrap(await db.initialize());
unwrap(
  await db.transaction((tx) => {
    const inserted = tx.insert('Item', { id: 'new-item', name: 'New item' }, { dataDir: './data/cogs' });
    if (!inserted.ok) throw inserted.error;
  }),
);
```

複数ディレクトリへの追加には、保存先を指定した`insert()`を使います。`batchInsert()`には保存先の引数がありません。行の保存先を保持するため、`execute()`、`query()`、`queryOne()`、`getDb()`からのSQLは読み取り専用です。

トランザクションでは書き込み前に対象ファイルを確認し、途中で失敗した場合は書き込み済みのファイルを復元します。Studioでは`writeDataSets`を自動で有効にします。

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

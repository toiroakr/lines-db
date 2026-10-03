import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as TS from 'typescript';

/** A column as the schema file declares it, read from the types of its Standard Schema */
export interface DeclaredColumn {
  name: string;
  /** The type of the values, without the null and undefined that the two flags below stand for */
  type: string;
  /** The field may be left out of a row: optional, or filled in by a default */
  optional: boolean;
  nullable: boolean;
}

// The same in the compiler API and in the Corsa API of typescript@7.1
const NULL = 8;
const UNION = 134217728;
const OPTIONAL = 16777216;
const ALIAS = 2097152;

/** The type checker of either API, as far as reading the columns needs it */
interface TypeReader<Type, Property> {
  /** The type of what the file exports as `schema`, or else as its default */
  entryType(): Type | undefined;
  property(type: Type, name: string): Property | undefined;
  typeOf(property: Property): Type;
  nonNullable(type: Type): Type;
  /** The types a union is of, or the type itself: the properties of a union are only those its members share */
  members(type: Type): readonly Type[];
  properties(type: Type): readonly Property[];
  nameOf(property: Property): string;
  isOptional(property: Property): boolean;
  isNullable(type: Type): boolean;
  text(type: Type): string;
}

/** What a reading found, and the files of the project it was read from, which a change to any of them makes stale */
interface Reading {
  columns: DeclaredColumn[] | undefined;
  files: string[];
}

/**
 * Standard Schema holds the types of what it validates in `~standard.types`, which every library that
 * implements it fills in, so the columns are read from the types and not from any one library
 */
function columnsOf<Type, Property>(reader: TypeReader<Type, Property>): DeclaredColumn[] | undefined {
  let type = reader.entryType();
  for (const name of ['~standard', 'types', 'input']) {
    const property = type && reader.property(type, name);
    if (!property) return undefined;
    type = reader.nonNullable(reader.typeOf(property));
  }
  const members = type ? reader.members(type) : [];
  const merged = new Map<string, { types: string[]; seen: number; optional: boolean; nullable: boolean }>();
  for (const member of members) {
    for (const property of reader.properties(member)) {
      const declared = reader.typeOf(property);
      const name = reader.nameOf(property);
      const column = merged.get(name) ?? { types: [], seen: 0, optional: false, nullable: false };
      const text = reader.text(reader.nonNullable(declared));
      if (!column.types.includes(text)) column.types.push(text);
      column.seen += 1;
      column.optional ||= reader.isOptional(property);
      column.nullable ||= reader.isNullable(declared);
      merged.set(name, column);
    }
  }
  if (merged.size === 0) return undefined;
  // A field a member of the union lacks may be left out of a row
  return [...merged].map(([name, column]) => ({
    name,
    type: column.types.join(' | '),
    optional: column.optional || column.seen < members.length,
    nullable: column.nullable,
  }));
}

function readWithCompilerApi(ts: typeof TS, schemaPath: string): Reading {
  const configPath = ts.findConfigFile(dirname(schemaPath), ts.sys.fileExists);
  const configured = configPath
    ? ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, dirname(configPath))
        .options
    : {};
  const program = ts.createProgram([schemaPath], {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    ...configured,
    noEmit: true,
    skipLibCheck: true,
    strictNullChecks: true,
    allowImportingTsExtensions: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(schemaPath);
  const module = file && checker.getSymbolAtLocation(file);
  const files = program
    .getSourceFiles()
    .filter((source) => !program.isSourceFileFromExternalLibrary(source) && !program.isSourceFileDefaultLibrary(source))
    .map((source) => source.fileName);
  if (configPath) files.push(configPath);
  if (!file || !module) return { columns: undefined, files };
  return {
    files,
    columns: columnsOf<TS.Type, TS.Symbol>({
      entryType() {
        const exports = checker.getExportsOfModule(module);
        let entry =
          exports.find((symbol) => symbol.name === 'schema') ?? exports.find((symbol) => symbol.name === 'default');
        if (entry && entry.flags & ALIAS) entry = checker.getAliasedSymbol(entry);
        return entry && checker.getTypeOfSymbolAtLocation(entry, file);
      },
      property: (type, name) => type.getProperty(name),
      typeOf: (property) => checker.getTypeOfSymbol(property),
      nonNullable: (type) => checker.getNonNullableType(type),
      members: (type) => (type.flags & UNION ? (type as TS.UnionType).types : [type]),
      properties: (type) => checker.getPropertiesOfType(type),
      nameOf: (property) => property.name,
      isOptional: (property) => Boolean(property.flags & OPTIONAL),
      isNullable: (type) =>
        type.flags & UNION
          ? (type as TS.UnionType).types.some((member) => member.flags & NULL)
          : Boolean(type.flags & NULL),
      text: (type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
    }),
  };
}

// What of the Corsa API this reads: the unstable API of typescript@7.1, which the compiler API's types do not describe
interface CorsaSymbol {
  name: string;
  flags: number;
}
interface CorsaType {
  flags: number;
  getProperty(name: string): CorsaSymbol | undefined;
  getTypes(): readonly CorsaType[] | undefined;
}
interface CorsaChecker {
  getSymbolOfSourceFile(file: string): CorsaSymbol | undefined;
  getExportsOfModule(symbol: CorsaSymbol): readonly CorsaSymbol[];
  getTypeOfSymbol(symbol: CorsaSymbol): CorsaType;
  getNonNullableType(type: CorsaType): CorsaType;
  getPropertiesOfType(type: CorsaType): readonly CorsaSymbol[];
  typeToString(type: CorsaType): string;
}
interface CorsaApi {
  createProgram(
    files: string[],
    options: Record<string, unknown>,
  ): { getProject(): { checker: CorsaChecker }; getSourceFileNames(): readonly string[] };
  close(): void;
}

function readWithCorsa(api: CorsaApi, schemaPath: string): Reading {
  try {
    // ESNext, Bundler and ESNext, as in the compiler API above
    const program = api.createProgram([schemaPath], {
      target: 99,
      module: 99,
      moduleResolution: 100,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      types: [],
    });
    const checker = program.getProject().checker;
    // Not the libraries, which are in node_modules or not on the disk at all
    const files = program.getSourceFileNames().filter((name) => isAbsolute(name) && !name.includes('/node_modules/'));
    const module = checker.getSymbolOfSourceFile(schemaPath);
    if (!module) return { columns: undefined, files };
    return {
      files,
      columns: columnsOf<CorsaType, CorsaSymbol>({
        entryType() {
          const exports = checker.getExportsOfModule(module);
          const entry =
            exports.find((symbol) => symbol.name === 'schema') ?? exports.find((symbol) => symbol.name === 'default');
          return entry && checker.getTypeOfSymbol(entry);
        },
        property: (type, name) => type.getProperty(name),
        typeOf: (property) => checker.getTypeOfSymbol(property),
        nonNullable: (type) => checker.getNonNullableType(type),
        members: (type) => (type.flags & UNION ? (type.getTypes() ?? [type]) : [type]),
        properties: (type) => checker.getPropertiesOfType(type),
        nameOf: (property) => property.name,
        isOptional: (property) => Boolean(property.flags & OPTIONAL),
        isNullable: (type) =>
          type.flags & UNION
            ? (type.getTypes() ?? []).some((member) => member.flags & NULL)
            : Boolean(type.flags & NULL),
        text: (type) => checker.typeToString(type),
      }),
    };
  } finally {
    api.close();
  }
}

/** The modification time of each file that can be read, which a reading is as fresh as */
async function stampsOf(files: string[]): Promise<Map<string, number>> {
  const stamps = new Map<string, number>();
  for (const file of new Set(files)) {
    try {
      stamps.set(file, (await stat(file)).mtimeMs);
    } catch {
      // Not on the disk: not something that can change it
    }
  }
  return stamps;
}

async function isFresh(stamps: Map<string, number>): Promise<boolean> {
  for (const [file, mtimeMs] of stamps) {
    try {
      if ((await stat(file)).mtimeMs !== mtimeMs) return false;
    } catch {
      return false;
    }
  }
  return true;
}

const cache = new Map<string, { columns: DeclaredColumn[] | undefined; stamps: Map<string, number> }>();

/**
 * The columns a schema file declares, read from its types with the TypeScript installed from `searchFrom`:
 * the compiler API of typescript 5 and 6, or the Corsa API of typescript 7.1 and later. Undefined when there
 * is none, the schema declares no types or the file cannot be read, so the caller can fall back on the rows.
 */
export async function readDeclaredColumns(
  schemaPath: string,
  searchFrom: string,
): Promise<DeclaredColumn[] | undefined> {
  try {
    // Not as given: the CLI passes the directory as it was typed, and createRequire takes only an absolute path
    const schemaFile = resolve(schemaPath);
    const from = resolve(searchFrom);
    const key = `${from}\0${schemaFile}`;
    const cached = cache.get(key);
    if (cached && (await isFresh(cached.stamps))) return cached.columns;

    const require = createRequire(join(from, 'noop.js'));
    const { version } = require('typescript/package.json') as { version: string };
    let reading: Reading;
    if (Number.parseInt(version, 10) >= 7) {
      const { API } = (await import(pathToFileURL(require.resolve('typescript/unstable/sync')).href)) as {
        API: new (options: { cwd: string }) => CorsaApi;
      };
      reading = readWithCorsa(new API({ cwd: dirname(schemaFile) }), schemaFile);
    } else {
      reading = readWithCompilerApi(require('typescript') as typeof TS, schemaFile);
    }
    cache.set(key, { columns: reading.columns, stamps: await stampsOf([schemaFile, ...reading.files]) });
    return reading.columns;
  } catch {
    return undefined;
  }
}

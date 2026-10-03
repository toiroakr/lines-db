import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
  properties(type: Type): readonly Property[];
  nameOf(property: Property): string;
  isOptional(property: Property): boolean;
  isNullable(type: Type): boolean;
  text(type: Type): string;
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
  const properties = type ? reader.properties(type) : [];
  if (properties.length === 0) return undefined;
  return properties.map((property) => {
    const declared = reader.typeOf(property);
    return {
      name: reader.nameOf(property),
      type: reader.text(reader.nonNullable(declared)),
      optional: reader.isOptional(property),
      nullable: reader.isNullable(declared),
    };
  });
}

function compilerApiReader(ts: typeof TS, schemaPath: string): TypeReader<TS.Type, TS.Symbol> | undefined {
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
  if (!file || !module) return undefined;
  return {
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
    properties: (type) => checker.getPropertiesOfType(type),
    nameOf: (property) => property.name,
    isOptional: (property) => Boolean(property.flags & OPTIONAL),
    isNullable: (type) =>
      type.flags & UNION
        ? (type as TS.UnionType).types.some((member) => member.flags & NULL)
        : Boolean(type.flags & NULL),
    text: (type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation),
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
  createProgram(files: string[], options: Record<string, unknown>): { getProject(): { checker: CorsaChecker } };
  close(): void;
}

function corsaReader(checker: CorsaChecker, schemaPath: string): TypeReader<CorsaType, CorsaSymbol> | undefined {
  const module = checker.getSymbolOfSourceFile(schemaPath);
  if (!module) return undefined;
  return {
    entryType() {
      const exports = checker.getExportsOfModule(module);
      const entry =
        exports.find((symbol) => symbol.name === 'schema') ?? exports.find((symbol) => symbol.name === 'default');
      return entry && checker.getTypeOfSymbol(entry);
    },
    property: (type, name) => type.getProperty(name),
    typeOf: (property) => checker.getTypeOfSymbol(property),
    nonNullable: (type) => checker.getNonNullableType(type),
    properties: (type) => checker.getPropertiesOfType(type),
    nameOf: (property) => property.name,
    isOptional: (property) => Boolean(property.flags & OPTIONAL),
    isNullable: (type) =>
      type.flags & UNION ? (type.getTypes() ?? []).some((member) => member.flags & NULL) : Boolean(type.flags & NULL),
    text: (type) => checker.typeToString(type),
  };
}

function readWithCorsa(api: CorsaApi, schemaPath: string): DeclaredColumn[] | undefined {
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
    const reader = corsaReader(program.getProject().checker, schemaPath);
    return reader && columnsOf(reader);
  } finally {
    api.close();
  }
}

const cache = new Map<string, { mtimeMs: number; columns: DeclaredColumn[] | undefined }>();

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
    const { mtimeMs } = await stat(schemaPath);
    const key = `${searchFrom}\0${schemaPath}`;
    const cached = cache.get(key);
    if (cached?.mtimeMs === mtimeMs) return cached.columns;

    const require = createRequire(join(searchFrom, 'noop.js'));
    const { version } = require('typescript/package.json') as { version: string };
    let columns: DeclaredColumn[] | undefined;
    if (Number.parseInt(version, 10) >= 7) {
      const { API } = (await import(pathToFileURL(require.resolve('typescript/unstable/sync')).href)) as {
        API: new (options: { cwd: string }) => CorsaApi;
      };
      columns = readWithCorsa(new API({ cwd: dirname(schemaPath) }), schemaPath);
    } else {
      const reader = compilerApiReader(require('typescript') as typeof TS, schemaPath);
      columns = reader && columnsOf(reader);
    }
    cache.set(key, { mtimeMs, columns });
    return columns;
  } catch {
    return undefined;
  }
}

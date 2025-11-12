import type { StandardSchema, Table, ForeignKeyDefinition, IndexDefinition } from './types.js';

/**
 * Schema options for defining constraints and indexes
 * When Input and Output types differ, backward transformation is required
 */
export type SchemaOptions<Input extends Table, Output extends Table> = {
  /**
   * Primary key column
   */
  primaryKey?: string;

  /**
   * Foreign key constraints
   */
  foreignKeys?: ForeignKeyDefinition[];

  /**
   * Indexes to create
   */
  indexes?: IndexDefinition[];
} & (Output extends Input
  ? {
      /**
       * Backward transformation from Output to Input (optional when output is substitutable for input)
       */
      backward?: (output: Output) => Input;
    }
  : {
      /**
       * Backward transformation from Output to Input (REQUIRED when types differ)
       */
      backward: (output: Output) => Input;
    });

/**
 * BiDirectional Schema interface
 * Extends StandardSchema with optional backward transformation and schema metadata
 */
export interface BiDirectionalSchema<Input extends Table = Table, Output extends Table = Input>
  extends StandardSchema<Input, Output> {
  /**
   * Backward transformation from Output to Input
   * Required when Input and Output types differ (e.g., with transformations)
   */
  backward?: (output: Output) => Input;

  /**
   * Primary key column
   */
  primaryKey?: string;

  /**
   * Foreign key constraints
   */
  foreignKeys?: ForeignKeyDefinition[];

  /**
   * Indexes to create
   */
  indexes?: IndexDefinition[];
}

/**
 * Define a bidirectional schema with optional backward transformation
 *
 * @param schema - Standard Schema for validation
 * @param options - SchemaOptions object. When Input and Output types differ, backward transformation is required
 *
 * @example
 * // No transformation - backward not needed
 * const schema = defineSchema(
 *   v.object({ id: v.number(), name: v.string() })
 * );
 *
 * @example
 * // With transformation - backward REQUIRED
 * const schema = defineSchema(
 *   v.pipe(v.string(), v.transform(Number)),
 *   {
 *     backward: (num) => String(num)  // backward: number → string (REQUIRED)
 *   }
 * );
 *
 * @example
 * // With primary key and foreign key
 * const schema = defineSchema(
 *   v.object({ id: v.number(), customerId: v.number() }),
 *   {
 *     primaryKey: 'id',
 *     foreignKeys: [
 *       { column: 'customerId', references: { table: 'users', column: 'id' } }
 *     ]
 *   }
 * );
 */
export function defineSchema<Input extends Table, Output extends Table>(
  schema: StandardSchema<Input, Output>,
  ...args: Output extends Input
    ? [options?: SchemaOptions<Input, Output>]
    : [options: SchemaOptions<Input, Output>]
): BiDirectionalSchema<Input, Output> {
  const options = args[0];
  // Create a new object that extends the schema
  const bidirectionalSchema = Object.create(schema) as BiDirectionalSchema<Input, Output>;

  // Handle options object
  if (options) {
    if (options.backward) {
      bidirectionalSchema.backward = options.backward as (output: Output) => Input;
    }
    if (options.primaryKey) {
      bidirectionalSchema.primaryKey = options.primaryKey;
    }
    if (options.foreignKeys) {
      bidirectionalSchema.foreignKeys = options.foreignKeys;
    }
    if (options.indexes) {
      bidirectionalSchema.indexes = options.indexes;
    }
  }

  // Copy '~standard' property
  Object.defineProperty(bidirectionalSchema, '~standard', {
    value: schema['~standard'],
    enumerable: true,
    configurable: true,
  });

  return bidirectionalSchema;
}

/**
 * Check if a schema has backward transformation
 */
export function hasBackward<Input extends Table, Output extends Table>(
  schema: StandardSchema<Input, Output>,
): schema is BiDirectionalSchema<Input, Output> {
  return 'backward' in schema && typeof (schema as { backward?: unknown }).backward === 'function';
}

import type { StandardSchema, Table, ForeignKeyDefinition, IndexDefinition } from './types.js';

/**
 * Schema options for defining constraints and indexes
 */
export interface SchemaOptions {
  /**
   * Primary key columns
   */
  primaryKey?: string[];

  /**
   * Foreign key constraints
   */
  foreignKeys?: ForeignKeyDefinition[];

  /**
   * Indexes to create
   */
  indexes?: IndexDefinition[];

  /**
   * Backward transformation from Output to Input
   * Required when Input and Output types differ (e.g., with transformations)
   */
  backward?: (output: Table) => Table;
}

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
   * Primary key columns
   */
  primaryKey?: string[];

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
 * @param optionsOrBackward - Optional SchemaOptions object or backward transformation function (Output → Input)
 *                            Required when schema performs transformations
 *
 * @example
 * // No transformation - backward not needed
 * const schema = defineSchema(
 *   v.object({ id: v.number(), name: v.string() })
 * );
 *
 * @example
 * // With transformation - backward recommended (legacy)
 * const schema = defineSchema(
 *   v.pipe(v.string(), v.transform(Number)),
 *   (num) => String(num)  // backward: number → string
 * );
 *
 * @example
 * // With primary key and foreign key
 * const schema = defineSchema(
 *   v.object({ id: v.number(), customerId: v.number() }),
 *   {
 *     primaryKey: ['id'],
 *     foreignKeys: [
 *       { columns: ['customerId'], references: { table: 'users', columns: ['id'] } }
 *     ]
 *   }
 * );
 */
export function defineSchema<Input extends Table, Output extends Table>(
  schema: StandardSchema<Input, Output>,
  optionsOrBackward?: SchemaOptions | ((output: Output) => Input),
): BiDirectionalSchema<Input, Output> {
  // Create a new object that extends the schema
  const bidirectionalSchema = Object.create(schema) as BiDirectionalSchema<Input, Output>;

  // Handle options or backward function
  if (optionsOrBackward) {
    if (typeof optionsOrBackward === 'function') {
      // Legacy: backward function only
      bidirectionalSchema.backward = optionsOrBackward;
    } else {
      // New: options object
      if (optionsOrBackward.backward) {
        bidirectionalSchema.backward = optionsOrBackward.backward as (output: Output) => Input;
      }
      if (optionsOrBackward.primaryKey) {
        bidirectionalSchema.primaryKey = optionsOrBackward.primaryKey;
      }
      if (optionsOrBackward.foreignKeys) {
        bidirectionalSchema.foreignKeys = optionsOrBackward.foreignKeys;
      }
      if (optionsOrBackward.indexes) {
        bidirectionalSchema.indexes = optionsOrBackward.indexes;
      }
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

import * as vscode from 'vscode';
import * as path from 'path';
import { TypeScriptTypeExtractor } from './typeInfoExtractor.js';

export interface ColumnSortResult {
  sortedRows: string[];
  columnOrder: string[];
}

/**
 * Get all unique column names from JSONL file
 */
export async function getAllColumns(filePath: string): Promise<string[]> {
  try {
    if (!global.__linesDbModule?.JsonlReader) {
      return [];
    }

    const records = await global.__linesDbModule.JsonlReader.read(filePath);
    if (!records || records.length === 0) {
      return [];
    }

    const columnsSet = new Set<string>();
    for (const record of records) {
      if (typeof record === 'object' && record !== null) {
        Object.keys(record).forEach((key) => columnsSet.add(key));
      }
    }

    return Array.from(columnsSet);
  } catch (error) {
    console.error(`Failed to get columns: ${error}`);
    return [];
  }
}

/**
 * Get column order from schema file by validating a sample record
 */
export async function getSchemaColumnOrder(jsonlFilePath: string): Promise<string[] | null> {
  try {
    const outputChannel = global.__linesDbOutputChannel;
    const dir = path.dirname(jsonlFilePath);
    const fileName = path.basename(jsonlFilePath, '.jsonl');
    const schemaPath = path.join(dir, `${fileName}.schema.ts`);

    if (outputChannel) {
      outputChannel.appendLine(`[SortColumns] Getting schema column order for: ${jsonlFilePath}`);
      outputChannel.appendLine(`[SortColumns] Schema path: ${schemaPath}`);
    }

    // Check if schema file exists
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(schemaPath));
    } catch {
      if (outputChannel) {
        outputChannel.appendLine(`[SortColumns] Schema file not found`);
      }
      return null;
    }

    // Load schema and get first record from JSONL
    if (!global.__linesDbModule?.SchemaLoader || !global.__linesDbModule?.JsonlReader) {
      if (outputChannel) {
        outputChannel.appendLine(`[SortColumns] LinesDB module not available`);
      }
      return null;
    }

    const schema = await global.__linesDbModule.SchemaLoader.loadSchema(jsonlFilePath);
    if (!schema) {
      if (outputChannel) {
        outputChannel.appendLine(`[SortColumns] Failed to load schema`);
      }
      return null;
    }

    // Read first record from JSONL file
    const records = await global.__linesDbModule.JsonlReader.read(jsonlFilePath);
    if (!records || records.length === 0) {
      if (outputChannel) {
        outputChannel.appendLine(`[SortColumns] No records found in JSONL file`);
      }
      return null;
    }

    const firstRecord = records[0];
    if (typeof firstRecord !== 'object' || firstRecord === null) {
      if (outputChannel) {
        outputChannel.appendLine(`[SortColumns] First record is not an object`);
      }
      return null;
    }

    // Validate the first record to get the column order from validation result
    const validateResult = schema['~standard'].validate(firstRecord);
    if (!validateResult || validateResult.issues) {
      if (outputChannel) {
        outputChannel.appendLine(`[SortColumns] Validation failed, using record keys as-is`);
      }
      // If validation fails, still try to use the record's keys
      return Object.keys(firstRecord as Record<string, unknown>);
    }

    const validatedValue = validateResult.value;
    if (typeof validatedValue !== 'object' || validatedValue === null) {
      if (outputChannel) {
        outputChannel.appendLine(`[SortColumns] Validated value is not an object`);
      }
      return null;
    }

    const columnOrder = Object.keys(validatedValue);
    if (outputChannel) {
      outputChannel.appendLine(`[SortColumns] Extracted column order from validate result: ${JSON.stringify(columnOrder)}`);
    }

    return columnOrder;
  } catch (error) {
    const outputChannel = global.__linesDbOutputChannel;
    if (outputChannel) {
      outputChannel.appendLine(`[SortColumns] Error getting schema column order: ${error}`);
    }
    console.error(`Failed to get schema column order: ${error}`);
    return null;
  }
}

/**
 * Sort a single JSON object by column order
 */
export function sortObjectByColumnOrder(
  obj: Record<string, unknown>,
  columnOrder: string[]
): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};

  // Add columns in specified order
  for (const column of columnOrder) {
    if (column in obj) {
      sorted[column] = obj[column];
    }
  }

  // Add any remaining columns not in the order (preserve their original relative order)
  for (const key in obj) {
    if (!(key in sorted)) {
      sorted[key] = obj[key];
    }
  }

  return sorted;
}

/**
 * Sort all rows in a JSONL file by column order
 */
export async function sortColumnsByOrder(
  filePath: string,
  columnOrder: string[]
): Promise<ColumnSortResult> {
  try {
    if (!global.__linesDbModule?.JsonlReader) {
      throw new Error('LinesDB module not available');
    }

    const records = await global.__linesDbModule.JsonlReader.read(filePath);
    if (!records || records.length === 0) {
      throw new Error('No records found in file');
    }

    const sortedRows: string[] = [];

    for (const record of records) {
      if (typeof record === 'object' && record !== null) {
        const sortedRecord = sortObjectByColumnOrder(
          record as Record<string, unknown>,
          columnOrder
        );
        sortedRows.push(JSON.stringify(sortedRecord));
      } else {
        // Keep non-object rows as-is
        sortedRows.push(JSON.stringify(record));
      }
    }

    return {
      sortedRows,
      columnOrder,
    };
  } catch (error) {
    throw new Error(
      `Failed to sort columns: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Show column picker for custom order selection
 */
async function pickColumnsSequentially(columns: string[]): Promise<string[] | null> {
  const selectedColumns: string[] = [];
  const remainingColumns = [...columns];

  while (remainingColumns.length > 0) {
    // Create description showing already selected columns
    let description = '';
    if (selectedColumns.length > 0) {
      description = `Selected:\n${selectedColumns.map((col, idx) => `${idx + 1}. ${col}`).join('\n')}`;
    } else {
      description = 'Select first column';
    }

    // Show quick pick for remaining columns
    const items = remainingColumns.map((col) => ({
      label: col,
      description: '',
    }));

    // Add "Done" option if at least one column is selected
    if (selectedColumns.length > 0) {
      items.unshift({
        label: '$(check) Done',
        description: 'Finish column selection',
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder:
        selectedColumns.length > 0
          ? `Select next column (${selectedColumns.length}/${columns.length} selected)`
          : 'Select first column',
      title: description,
    });

    if (!picked) {
      // User cancelled
      return null;
    }

    if (picked.label === '$(check) Done') {
      // User finished selection
      break;
    }

    // Add selected column and remove from remaining
    selectedColumns.push(picked.label);
    const index = remainingColumns.indexOf(picked.label);
    if (index > -1) {
      remainingColumns.splice(index, 1);
    }
  }

  // Add any remaining columns at the end
  if (remainingColumns.length > 0) {
    selectedColumns.push(...remainingColumns);
  }

  return selectedColumns;
}

/**
 * Show column order picker and sort columns
 */
export async function showColumnOrderPicker(
  filePath: string
): Promise<ColumnSortResult | null> {
  try {
    // Get all columns from the file
    const columns = await getAllColumns(filePath);
    if (columns.length === 0) {
      vscode.window.showErrorMessage('No columns found in file');
      return null;
    }

    // Try to get schema order as default
    const schemaOrder = await getSchemaColumnOrder(filePath);

    // Show quick pick for column ordering
    const result = await vscode.window.showQuickPick(
      [
        {
          label: '$(symbol-field) Use Schema Validation Order',
          description: schemaOrder
            ? `Sort by order from schema validation result`
            : 'No schema file or records found',
          value: 'schema',
          disabled: !schemaOrder,
        },
        {
          label: '$(sort-precedence) Alphabetical Order',
          description: 'Sort columns alphabetically',
          value: 'alphabetical',
        },
        {
          label: '$(edit) Custom Order',
          description: 'Manually select column order one by one',
          value: 'custom',
        },
      ],
      {
        placeHolder: 'Select column sorting method',
      }
    );

    if (!result) {
      return null;
    }

    let columnOrder: string[];

    if (result.value === 'schema' && schemaOrder) {
      columnOrder = schemaOrder;
    } else if (result.value === 'alphabetical') {
      columnOrder = [...columns].sort();
    } else if (result.value === 'custom') {
      // Show sequential column picker
      const customOrder = await pickColumnsSequentially(columns);
      if (!customOrder) {
        return null;
      }
      columnOrder = customOrder;
    } else {
      return null;
    }

    // Sort columns
    return await sortColumnsByOrder(filePath, columnOrder);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to sort columns: ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

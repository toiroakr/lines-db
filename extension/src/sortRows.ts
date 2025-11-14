import * as vscode from 'vscode';
import { getAllColumns } from './sortColumns';

export interface SortKey {
  column: string;
  order: 'asc' | 'desc';
}

export interface RowSortResult {
  sortedRows: string[];
  sortKeys: SortKey[];
}

/**
 * Show sort configuration UI and sort rows
 */
export async function showRowSortPicker(filePath: string): Promise<RowSortResult | null> {
  const outputChannel = global.__linesDbOutputChannel;

  try {
    // Get available columns
    const columns = await getAllColumns(filePath);
    if (columns.length === 0) {
      vscode.window.showErrorMessage('No columns found in file');
      return null;
    }

    if (outputChannel) {
      outputChannel.appendLine(`[SortRows] Available columns: ${columns.join(', ')}`);
    }

    const sortKeys: SortKey[] = [];

    // 1. Configure Primary Key (required)
    const primaryKey = await configureSortKey(columns, sortKeys, true);
    if (!primaryKey) {
      return null; // User cancelled
    }
    sortKeys.push(primaryKey);

    if (outputChannel) {
      outputChannel.appendLine(
        `[SortRows] Primary key: ${primaryKey.column} (${primaryKey.order})`,
      );
    }

    // 2. Ask if user wants to add Secondary Key
    const addSecondary = await vscode.window.showQuickPick(
      [
        {
          label: '$(add) Add Secondary Sort Key',
          description: 'Add another sort criteria',
          value: 'add',
        },
        {
          label: '$(check) Done',
          description: 'Sort with primary key only',
          value: 'done',
        },
      ],
      {
        placeHolder: 'Add secondary sort key?',
        title: `Primary: ${primaryKey.column} (${primaryKey.order === 'asc' ? 'Ascending' : 'Descending'})`,
      },
    );

    if (!addSecondary) {
      return null; // User cancelled
    }

    // 3. Configure Secondary Key if user chose to add
    if (addSecondary.value === 'add') {
      const secondaryKey = await configureSortKey(columns, sortKeys, false);
      if (!secondaryKey) {
        // User cancelled during secondary key selection, but we have primary key
        // Continue with primary key only
        if (outputChannel) {
          outputChannel.appendLine('[SortRows] Secondary key cancelled, using primary only');
        }
      } else {
        sortKeys.push(secondaryKey);
        if (outputChannel) {
          outputChannel.appendLine(
            `[SortRows] Secondary key: ${secondaryKey.column} (${secondaryKey.order})`,
          );
        }
      }
    }

    // 4. Sort rows
    return await sortRowsBySortKeys(filePath, sortKeys);
  } catch (error) {
    if (outputChannel) {
      outputChannel.appendLine(`[SortRows] Error: ${error}`);
    }
    throw error;
  }
}

/**
 * Configure a single sort key
 */
async function configureSortKey(
  columns: string[],
  existingSortKeys: SortKey[],
  isPrimary: boolean,
): Promise<SortKey | null> {
  const outputChannel = global.__linesDbOutputChannel;

  // Filter out already used columns
  const usedColumns = new Set(existingSortKeys.map((k) => k.column));
  const availableColumns = columns.filter((c) => !usedColumns.has(c));

  if (availableColumns.length === 0) {
    vscode.window.showInformationMessage('All columns are already used as sort keys');
    return null;
  }

  // Show column picker
  const columnItems = availableColumns.map((col) => ({
    label: col,
    description: '',
  }));

  const keyLabel = isPrimary ? 'Primary' : 'Secondary';
  const title =
    existingSortKeys.length > 0
      ? `Current: ${existingSortKeys.map((k) => `${k.column} (${k.order})`).join(', ')}`
      : undefined;

  const selectedColumn = await vscode.window.showQuickPick(columnItems, {
    placeHolder: `Select ${keyLabel} sort key`,
    title: title,
  });

  if (!selectedColumn) {
    return null; // User cancelled
  }

  if (outputChannel) {
    outputChannel.appendLine(`[SortRows] Selected column: ${selectedColumn.label}`);
  }

  // Show order picker
  const orderResult = await vscode.window.showQuickPick(
    [
      {
        label: '$(arrow-up) Ascending',
        description: 'Sort from smallest to largest (A-Z, 0-9)',
        value: 'asc' as const,
      },
      {
        label: '$(arrow-down) Descending',
        description: 'Sort from largest to smallest (Z-A, 9-0)',
        value: 'desc' as const,
      },
    ],
    {
      placeHolder: `Select sort order for "${selectedColumn.label}"`,
    },
  );

  if (!orderResult) {
    return null; // User cancelled
  }

  if (outputChannel) {
    outputChannel.appendLine(`[SortRows] Selected order: ${orderResult.value}`);
  }

  return {
    column: selectedColumn.label,
    order: orderResult.value,
  };
}

/**
 * Sort rows by multiple sort keys
 */
async function sortRowsBySortKeys(filePath: string, sortKeys: SortKey[]): Promise<RowSortResult> {
  const outputChannel = global.__linesDbOutputChannel;

  if (!global.__linesDbModule?.JsonlReader) {
    throw new Error('LinesDB module not available');
  }

  const records = await global.__linesDbModule.JsonlReader.read(filePath);
  if (!records || records.length === 0) {
    throw new Error('No records found in file');
  }

  if (outputChannel) {
    outputChannel.appendLine(`[SortRows] Sorting ${records.length} records`);
    outputChannel.appendLine(
      `[SortRows] Sort keys: ${sortKeys.map((k) => `${k.column} (${k.order})`).join(', ')}`,
    );
  }

  // Sort with multi-key comparison
  const sortedRecords = [...records].sort((a, b) => {
    for (const key of sortKeys) {
      const aVal = (a as Record<string, unknown>)[key.column];
      const bVal = (b as Record<string, unknown>)[key.column];

      let comparison = 0;

      // Handle null/undefined
      if (aVal == null && bVal == null) continue;
      if (aVal == null) return key.order === 'asc' ? 1 : -1; // null goes to end for asc
      if (bVal == null) return key.order === 'asc' ? -1 : 1; // null goes to end for asc

      // Compare values
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else if (typeof aVal === 'boolean' && typeof bVal === 'boolean') {
        comparison = aVal === bVal ? 0 : aVal ? 1 : -1;
      } else {
        // Fallback: string comparison
        comparison = String(aVal).localeCompare(String(bVal));
      }

      if (comparison !== 0) {
        return key.order === 'asc' ? comparison : -comparison;
      }
    }
    return 0;
  });

  const sortedRows = sortedRecords.map((record) => JSON.stringify(record));

  if (outputChannel) {
    outputChannel.appendLine(`[SortRows] Sorting complete`);
  }

  return {
    sortedRows,
    sortKeys,
  };
}

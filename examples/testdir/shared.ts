// Shared type definition to test relative imports with \t in path
// Path: examples/testdir/shared.ts (contains \t when resolved on Windows)

export const STATUS_VALUES = ['active', 'inactive', 'pending'] as const;

export type Status = (typeof STATUS_VALUES)[number];

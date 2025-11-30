// Shared type for testing Windows path resolution
// Path ../testdir/ contains \t which may be interpreted as tab on Windows

// Import external package to reproduce SDK issue
// SDK's tailordb/customer.ts imports from @tailor-platform/sdk
// This import triggers the Windows CMD path resolution bug
import * as v from 'valibot';

export const STATUS_VALUES = ['active', 'inactive', 'pending'] as const;

export type Status = (typeof STATUS_VALUES)[number];

// Use valibot to ensure the import is not tree-shaken
export const statusSchema = v.union(STATUS_VALUES.map((s) => v.literal(s)));

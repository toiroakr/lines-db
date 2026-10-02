import { useEffect, useRef, useState } from 'react';
import type { Issue } from './types';
import type { Batch } from './pending';

export type CheckResult = { ok: true } | { ok: false; message?: string; issues: Issue[] };

function segmentKey(segment: NonNullable<Issue['path']>[number]): string {
  return typeof segment === 'object' && segment !== null && 'key' in segment ? String(segment.key) : String(segment);
}

export function issuePath(issue: Issue): string {
  return (issue.path ?? []).map(segmentKey).join('.') || 'row';
}

/** The issues about a field, nested values included, and those about no field in particular */
export function issuesFor(field: string, issues: Issue[]): Issue[] {
  return issues.filter((issue) => !issue.path?.length || segmentKey(issue.path[0]) === field);
}

export async function checkChanges(table: string, batch: Batch, signal: AbortSignal): Promise<CheckResult> {
  const response = await fetch(`/api/tables/${encodeURIComponent(table)}/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batch),
    signal,
  });
  return (await response.json()) as CheckResult;
}

/**
 * Check the batch a value would make once typing pauses, as the server would validate it on save.
 * Undefined while the value cannot be checked or the answer is pending.
 */
export function useLiveCheck(table: string, batch: Batch | undefined): { result?: CheckResult; checking: boolean } {
  const [result, setResult] = useState<CheckResult>();
  const [checking, setChecking] = useState(false);
  const serialized = batch ? JSON.stringify(batch) : undefined;
  const latest = useRef(0);

  useEffect(() => {
    setResult(undefined);
    if (!serialized) return;
    const id = ++latest.current;
    const controller = new AbortController();
    setChecking(true);
    const timer = setTimeout(() => {
      checkChanges(table, JSON.parse(serialized) as Batch, controller.signal)
        .then((answer) => {
          if (id === latest.current) setResult(answer);
        })
        .catch(() => undefined)
        .finally(() => {
          if (id === latest.current) setChecking(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [table, serialized]);

  return { result, checking };
}

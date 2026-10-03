import { useEffect, useRef, useState } from 'react';
import type { Issue } from './types';
import type { Batch } from './pending';
import { authorized } from './session';

export type CheckResult =
  | { ok: true }
  | { ok: false; message?: string; issues: Issue[] }
  /** The check itself could not run, so the value is neither valid nor invalid as far as is known */
  | { ok: false; failed: string };

export function segmentKey(segment: NonNullable<Issue['path']>[number]): string {
  return typeof segment === 'object' && segment !== null && 'key' in segment ? String(segment.key) : String(segment);
}

export function issuePath(issue: Issue): string {
  return (issue.path ?? []).map(segmentKey).join('.') || 'row';
}

/** The issues about a field, nested values included */
export function fieldIssues(field: string, issues: Issue[]): Issue[] {
  return issues.filter((issue) => issue.path?.length && segmentKey(issue.path[0]) === field);
}

/** The issues a check found, a refusal SQLite gives, such as a unique constraint, being one with a message alone */
export function issuesOf(result: CheckResult | undefined): Issue[] {
  if (!result || result.ok || !('issues' in result)) return [];
  return result.issues.length > 0 || !result.message ? result.issues : [{ message: result.message }];
}

/** The issues about a field, nested values included, and those about no field in particular */
export function issuesFor(field: string, result: CheckResult | undefined): Issue[] {
  const issues = issuesOf(result);
  const scoped = issues.filter((issue) => !issue.path?.length || segmentKey(issue.path[0]) === field);
  // Not only the edited field's: the value can be refused through a check on another field
  return scoped.length > 0 ? scoped : issues;
}

export async function checkChanges(table: string, batch: Batch, signal: AbortSignal): Promise<CheckResult> {
  const response = await fetch(
    `/api/tables/${encodeURIComponent(table)}/check`,
    authorized({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch),
      signal,
    }),
  );
  const body = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; issues?: Issue[] };
  if (response.ok && body.ok === true) return { ok: true };
  if (response.ok && body.ok === false) return { ok: false, message: body.message, issues: body.issues ?? [] };
  return { ok: false, failed: body.message ?? `The check failed with status ${response.status}` };
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
    const id = ++latest.current;
    setChecking(Boolean(serialized));
    if (!serialized) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      checkChanges(table, JSON.parse(serialized) as Batch, controller.signal)
        .then((answer) => {
          if (id === latest.current && !controller.signal.aborted) setResult(answer);
        })
        .catch((error: unknown) => {
          if (id === latest.current && !controller.signal.aborted) {
            setResult({ ok: false, failed: error instanceof Error ? error.message : String(error) });
          }
        })
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

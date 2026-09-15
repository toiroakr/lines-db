/**
 * A discriminated union for operations that can fail without throwing.
 * Used throughout the JS programmatic API (`LinesDB`, `JsonlReader`) so callers get a typed
 * error back instead of having to wrap every call in try/catch.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** Normalize a thrown value (which may not be an Error) into an Error. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Unwrap a Result, throwing its error when it is not ok. */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw result.error;
}

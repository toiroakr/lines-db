/**
 * Unwrap a Result returned by the dynamically-loaded @toiroakr/lines-db module
 * (LinesDB.initialize/close, JsonlReader.read), throwing its error when it is not ok.
 */
export function unwrapLinesDbResult<T>(result: LinesDbResult<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}

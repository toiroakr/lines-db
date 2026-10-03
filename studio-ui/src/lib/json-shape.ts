import type { Issue, JsonObject, JsonValue } from './types';
import { segmentKey } from './check';

/** How the form shows a JSON value: a field per scalar, a block per map or list, a JSON editor otherwise */
export type Shape = 'boolean' | 'number' | 'string' | 'null' | 'map' | 'list' | 'json';

export type Path = Array<string | number>;

const isMap = (value: JsonValue | undefined): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isScalar = (value: JsonValue) => value === null || typeof value !== 'object';

/** Whether the form can show the value field by field */
function representable(value: JsonValue): boolean {
  if (isScalar(value)) return true;
  if (Array.isArray(value)) {
    return (value.every(isScalar) || value.every(isMap)) && value.every(representable);
  }
  return Object.values(value).every(representable);
}

export function shapeOf(value: JsonValue): Shape {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') return 'string';
  if (!representable(value)) return 'json';
  return Array.isArray(value) ? 'list' : 'map';
}

export function setIn(value: JsonValue, path: Path, next: JsonValue): JsonValue {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[Number(head)] = setIn(copy[Number(head)] ?? null, rest, next);
    return copy;
  }
  const map = isMap(value) ? value : {};
  return { ...map, [head]: setIn(map[head] ?? null, rest, next) };
}

export function removeIn(value: JsonValue, path: Path): JsonValue {
  const [head, ...rest] = path;
  if (rest.length > 0) {
    if (Array.isArray(value)) return value.map((item, index) => (index === head ? removeIn(item, rest) : item));
    return isMap(value) ? { ...value, [head]: removeIn(value[head] ?? null, rest) } : value;
  }
  if (Array.isArray(value)) return value.filter((_, index) => index !== head);
  if (!isMap(value)) return value;
  const { [head]: _removed, ...others } = value;
  return others;
}

/** A value shaped as the sample with nothing filled in, for a new item of a list */
export function emptyLike(sample: JsonValue | undefined): JsonValue {
  if (sample === undefined) return '';
  if (sample === null) return null;
  if (typeof sample === 'boolean') return false;
  if (typeof sample === 'number') return 0;
  if (typeof sample === 'string') return '';
  if (Array.isArray(sample)) return [];
  return Object.fromEntries(Object.entries(sample).map(([key, value]) => [key, emptyLike(value)]));
}

const startsWith = (issue: Issue, path: Path) =>
  path.every(
    (segment, index) => issue.path?.[index] !== undefined && segmentKey(issue.path[index]) === String(segment),
  );

/** The issues about exactly the value at the path */
export function issuesAt(issues: Issue[], path: Path): Issue[] {
  return issues.filter((issue) => issue.path?.length === path.length && startsWith(issue, path));
}

/** The issues about the value at the path and the values inside it */
export function issuesUnder(issues: Issue[], path: Path): Issue[] {
  return issues.filter((issue) => (issue.path?.length ?? 0) >= path.length && startsWith(issue, path));
}

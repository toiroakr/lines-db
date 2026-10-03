export interface HashState {
  /** The table shown in the grid, or an empty string for none */
  table: string;
  /** The table whose schema is open, or null when none is */
  schema: string | null;
}

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return '';
  }
};

/** The state a location hash holds: `#table`, or `#table?schema=other` with the schema of `other` open */
export function parseHash(hash: string): HashState {
  const [table = '', query] = hash.slice(1).split('?', 2);
  const schema = query === undefined ? null : new URLSearchParams(query).get('schema');
  return { table: decode(table), schema: schema || null };
}

export function formatHash(table: string, schema?: string | null): string {
  const base = `#${encodeURIComponent(table)}`;
  return schema ? `${base}?schema=${encodeURIComponent(schema)}` : base;
}

/** The schemas opened before the one shown, which a link to a schema writes into the state of its history entry */
export function schemaTrailOf(state: unknown): string[] {
  const trail = (state as { schemaTrail?: unknown } | null)?.schemaTrail;
  return Array.isArray(trail) && trail.every((name) => typeof name === 'string') ? trail : [];
}

/** Whether the page pushed the history entry to open a schema, so that closing it can go back to where it began */
export function schemaOpenedInApp(state: unknown): boolean {
  return (state as { schemaInApp?: unknown } | null)?.schemaInApp === true;
}

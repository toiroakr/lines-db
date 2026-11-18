const KEY = 'lines-db-studio:token';
let fallback = '';
let pageHeaders: Record<string, string> = {};

function stored(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Keep for this tab the token the page was served with, and take it out of the page. A page served
 * without one, as by a development server that could not reach the studio, goes on with the token the
 * tab already holds
 */
export function adoptToken(): void {
  adoptRequestHeaders();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="studio-token"]');
  if (!meta) return;
  try {
    sessionStorage.setItem(KEY, meta.content);
  } catch {
    fallback = meta.content;
  }
  meta.remove();
}

/** The headers a host that frames the studio has the page send, which it checks before passing a request on */
function adoptRequestHeaders(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="studio-request-headers"]');
  pageHeaders = {};
  if (!meta) return;
  pageHeaders = JSON.parse(meta.content) as Record<string, string>;
  meta.remove();
}

const token = () => stored() || fallback;

/** Merges header sets in order, a later one replacing an earlier header of the same name whatever its case */
function mergeHeaders(...sets: Record<string, string>[]): Record<string, string> {
  const merged = new Map<string, [string, string]>();
  for (const set of sets) {
    for (const [name, value] of Object.entries(set)) merged.set(name.toLowerCase(), [name, value]);
  }
  return Object.fromEntries(merged.values());
}

/** A request's options with the token in its headers */
export function authorized(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: mergeHeaders(pageHeaders, (init.headers ?? {}) as Record<string, string>, {
      Authorization: `Bearer ${token()}`,
    }),
  };
}

/** The address of the event stream, with the token in its query */
export function eventsUrl(): string {
  return `./api/events?token=${encodeURIComponent(token())}`;
}

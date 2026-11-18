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
  if (!meta) return;
  pageHeaders = JSON.parse(meta.content) as Record<string, string>;
  meta.remove();
}

const token = () => stored() || fallback;

/** A request's options with the token in its headers */
export function authorized(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { ...(init.headers as Record<string, string>), ...pageHeaders, Authorization: `Bearer ${token()}` },
  };
}

/** The address of the event stream, with the token in its query */
export function eventsUrl(): string {
  return `./api/events?token=${encodeURIComponent(token())}`;
}

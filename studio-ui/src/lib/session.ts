const KEY = 'lines-db-studio:token';
let fallback = '';

function stored(): string {
  try {
    return sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Keep for this tab the token the page was served with. Only the first page the server serves carries
 * one, so a reload, which comes without it, goes on with the token the tab already holds
 */
export function adoptToken(): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="studio-token"]');
  if (!meta) return;
  try {
    sessionStorage.setItem(KEY, meta.content);
  } catch {
    // Not kept past this page: a reload then comes without the token
    fallback = meta.content;
  }
  meta.remove();
}

const token = () => stored() || fallback;

/** A request's options with the token in its headers */
export function authorized(init: RequestInit = {}): RequestInit {
  return { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token()}` } };
}

/** The address of the event stream, with the token in its query */
export function eventsUrl(): string {
  return `/api/events?token=${encodeURIComponent(token())}`;
}

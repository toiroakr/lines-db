import { describe, it, expect, beforeEach } from 'vitest';
import { adoptToken, authorized, eventsUrl } from './session';

describe('the studio token', () => {
  beforeEach(() => {
    sessionStorage.clear();
    document.head.innerHTML = '';
  });

  const servePageWith = (token: string) => {
    document.head.innerHTML = `<meta name="studio-token" content="${token}">`;
  };

  it('keeps the token the page was served with for the tab, and takes it out of the page', () => {
    servePageWith('first');

    adoptToken();

    expect(authorized().headers).toEqual({ Authorization: 'Bearer first' });
    expect(document.querySelector('meta[name="studio-token"]')).toBeNull();
  });

  it('keeps the token the tab already holds when the page comes without one, as on a reload', () => {
    servePageWith('first');
    adoptToken();
    document.head.innerHTML = '';

    adoptToken();

    expect(authorized().headers).toEqual({ Authorization: 'Bearer first' });
  });

  it('adds the token to the headers a request already has', () => {
    servePageWith('first');
    adoptToken();

    expect(authorized({ method: 'POST', headers: { 'Content-Type': 'application/json' } })).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer first' },
    });
  });

  it('gives the event stream the token in its query, as an event source cannot send headers', () => {
    servePageWith('a/b+c');
    adoptToken();

    expect(eventsUrl()).toBe('/api/events?token=a%2Fb%2Bc');
  });
});

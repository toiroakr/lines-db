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

  it('sends the headers the page was served with along with the token, and takes them out of the page', () => {
    document.head.innerHTML =
      '<meta name="studio-token" content="first">' +
      '<meta name="studio-request-headers" content="{&quot;x-host-token&quot;:&quot;a&amp;b&quot;}">';

    adoptToken();

    expect(authorized({ headers: { 'Content-Type': 'application/json' } }).headers).toEqual({
      'Content-Type': 'application/json',
      'x-host-token': 'a&b',
      Authorization: 'Bearer first',
    });
    expect(document.querySelector('meta[name="studio-request-headers"]')).toBeNull();
  });

  describe('a header the page was served with that a request also sets', () => {
    const adoptHeaders = (headers: Record<string, string>) => {
      const content = JSON.stringify(headers).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
      document.head.innerHTML = `<meta name="studio-token" content="first"><meta name="studio-request-headers" content="${content}">`;
      adoptToken();
    };

    it('leaves the content type the request set in place', () => {
      adoptHeaders({ 'Content-Type': 'text/plain' });

      expect(authorized({ headers: { 'Content-Type': 'application/json' } }).headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer first',
      });
    });

    it('does not carry over to the next page that comes without headers', () => {
      adoptHeaders({ 'x-host-token': 'a' });
      document.head.innerHTML = '<meta name="studio-token" content="second">';

      adoptToken();

      expect(authorized().headers).toEqual({ Authorization: 'Bearer second' });
    });

    it('never sends the token twice under another spelling of its name', () => {
      adoptHeaders({ authorization: 'Bearer host' });

      expect(authorized().headers).toEqual({ Authorization: 'Bearer first' });
    });
  });

  it('gives the event stream the token in its query, as an event source cannot send headers', () => {
    servePageWith('a/b+c');
    adoptToken();

    expect(eventsUrl()).toBe('./api/events?token=a%2Fb%2Bc');
  });
});

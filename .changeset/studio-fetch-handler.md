---
'@lines-db/studio': patch
---

Add `createStudioHandler`, which resolves to `{ token, fetch(request), close() }`. Its `fetch` is a Web-standard `(request: Request) => Promise<Response>` handler, so the studio can be served from a server of your own and framed by a page of the same origin. `startStudioServer` is now a thin `node:http` wrapper around it and behaves as before.

The page asks for the API with addresses relative to its own, so it works below any path, as long as it is opened with a trailing slash. `frameAncestors: 'self'` lets a page of the same origin frame the studio (`'none'` by default), and `requestHeaders` has the page send the given headers with every API request except the event stream, which an `EventSource` cannot give headers, for a host that checks them before passing a request on. The values are written into the page, so they are not secrets from whoever can load it. A write is rejected when its `Origin` is present and not the origin of the request URL.

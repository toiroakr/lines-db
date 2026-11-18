---
'@lines-db/studio': patch
---

Add `createStudioHandler`, a Web-standard `(request: Request) => Promise<Response>` handler, so the studio can be served from a server of your own and framed by a page of the same origin. `startStudioServer` is now a thin `node:http` wrapper around it and behaves as before.

The page asks for the API with addresses relative to its own, so it works below any path, as long as it is opened with a trailing slash. `frameAncestors: 'self'` lets a page of the same origin frame the studio (`'none'` by default), and `requestHeaders` has the page send the given headers with every API request, for a host that checks them before passing a request on. A write is accepted when its `Origin` is the origin of the request URL.

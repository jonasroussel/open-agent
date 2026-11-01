import { resolve, sep } from 'node:path';

/**
 * Serves the built client. Unknown paths get `index.html`, so a reload on any page works. Vite puts a content hash
 * in every file name under `/assets/`, so those can be cached for good; `index.html` must always be checked again.
 */
export function createStaticFiles(distPath: string) {
  const root = resolve(distPath);
  const indexHtml = Bun.file(resolve(root, 'index.html'));

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });

    const { pathname } = new URL(request.url);
    const path = resolve(root, `.${decodeURIComponent(pathname)}`);
    // Never serve anything outside the client folder ("/../").
    if (path.startsWith(root + sep)) {
      const file = Bun.file(path);
      if (await file.exists()) {
        const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
        return new Response(file, { headers: { 'cache-control': cache } });
      }
    }
    return new Response(indexHtml, { headers: { 'cache-control': 'no-cache', 'content-type': 'text/html' } });
  };
}

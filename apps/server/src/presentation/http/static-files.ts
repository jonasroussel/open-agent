import { resolve, sep } from 'node:path';

/**
 * Nothing the page shows may send data out of the browser: a prompt-injected answer or a model-written HTML page
 * (the canvas `srcdoc` iframe inherits this policy) reaches only the app itself. Inline scripts stay allowed: the
 * theme script of `index.html` and the canvas pages need them.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

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
    const path = filePath(root, pathname);
    // Never serve anything outside the client folder ("/../").
    if (path?.startsWith(root + sep)) {
      const file = Bun.file(path);
      if (await file.exists()) {
        const cache = pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
        return new Response(file, {
          headers: { 'cache-control': cache, 'content-security-policy': CONTENT_SECURITY_POLICY },
        });
      }
    }
    return new Response(indexHtml, {
      headers: {
        'cache-control': 'no-cache',
        'content-type': 'text/html',
        'content-security-policy': CONTENT_SECURITY_POLICY,
      },
    });
  };
}

/** `null` for a malformed percent-escape (`/%E0%A4%A`): answered like an unknown path. */
function filePath(root: string, pathname: string): string | null {
  try {
    return resolve(root, `.${decodeURIComponent(pathname)}`);
  } catch {
    return null;
  }
}

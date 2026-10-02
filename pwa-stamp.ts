/**
 * The text substitutions `vite.config.ts` applies to the built PWA files, kept
 * free of I/O so they can be tested on strings. The plugins own reading,
 * writing, the clock and `BASE_PATH`; these functions own what changes.
 */

export interface ServiceWorkerStamp {
  version: string;
  basePath: string;
  isDev: boolean;
}

export function stampServiceWorker(
  source: string,
  { version, basePath, isDev }: ServiceWorkerStamp,
) {
  let content = source.replace("__BUILD_VERSION__", version);
  content = content.replace(/self\.__BASE_PATH__/g, `"${basePath}"`);

  if (isDev) {
    content = content.replace(/\/icons\/icon-192\.png/g, "/icons/icon-192-dev.png");
    content = content.replace(/\/icons\/icon-512\.png/g, "/icons/icon-512-dev.png");
    content = content.replace(/\/icons\/apple-touch-icon\.png/g, "/icons/apple-touch-icon-dev.png");
  }

  return content;
}

export function substituteBasePath(html: string, basePath: string) {
  // Two rules: the script tag's placeholder is a bare string, not a path prefix.
  const content = html.replace(
    /window\.__BASE_PATH__ = "__BASE_PATH__"/g,
    `window.__BASE_PATH__ = "${basePath}"`,
  );
  return content.replace(/__BASE_PATH__\//g, `${basePath}/`);
}

export function stampManifest(source: string, basePath: string) {
  const manifest = JSON.parse(source);
  // `id` equals the start_url a manifest without one is identified by, so a
  // phone that installed before `id` existed keeps the same app.
  manifest.id = `${basePath}/`;
  manifest.start_url = `${basePath}/`;
  manifest.scope = `${basePath}/`;
  if (manifest.icons) {
    manifest.icons = manifest.icons.map((icon: { src: string }) => ({
      ...icon,
      src: basePath + icon.src,
    }));
  }
  return JSON.stringify(manifest, null, 2);
}

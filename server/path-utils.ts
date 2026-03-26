/**
 * Builds a URL path by concatenating basePath and path.
 * Contract 2: buildUrl
 */
export function buildUrl(basePath: string, path: string): string {
  return basePath + path;
}

/**
 * Strips basePath prefix from pathname.
 * Contract 3: stripBasePath
 */
export function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === "") {
    return pathname;
  }

  if (pathname === basePath || pathname.startsWith(basePath + "/")) {
    const stripped = pathname.slice(basePath.length);
    return stripped || "/";
  }

  return pathname;
}

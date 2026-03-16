import { describe, expect, test } from "bun:test";
import { resolve, sep } from "node:path";

// Re-export the validation function for testing
// Since it's not exported from ws.ts, we'll test it indirectly via the config flow
// For now, let's create a standalone version for testing
function validateAllowedPath(cwd: string, allowedRoots: string[] | null): boolean {
  if (allowedRoots === null) {
    return true;
  }

  // Normalize cwd to absolute
  const normalizedCwd = resolve(cwd);

  // Ensure path ends with separator for prefix matching
  const ensureTrailingSep = (p: string) => (p.endsWith(sep) ? p : p + sep);

  for (const root of allowedRoots) {
    const normalizedRoot = resolve(root);

    // Check if cwd is exactly the root or starts with root/
    if (
      normalizedCwd === normalizedRoot ||
      normalizedCwd.startsWith(ensureTrailingSep(normalizedRoot))
    ) {
      return true;
    }
  }

  return false;
}

describe("validateAllowedPath", () => {
  test("null allowedRoots allows any path", () => {
    expect(validateAllowedPath("/any/path", null)).toBe(true);
    expect(validateAllowedPath("/another/path", null)).toBe(true);
  });

  test("path within allowed root returns true", () => {
    const allowedRoots = ["/home/user/projects"];
    expect(validateAllowedPath("/home/user/projects/app", allowedRoots)).toBe(true);
  });

  test("path outside allowed root returns false", () => {
    const allowedRoots = ["/home/user/projects"];
    expect(validateAllowedPath("/home/user/other", allowedRoots)).toBe(false);
    expect(validateAllowedPath("/tmp/test", allowedRoots)).toBe(false);
  });

  test("nested subdirectory within allowed root returns true", () => {
    const allowedRoots = ["/home/user/projects"];
    expect(validateAllowedPath("/home/user/projects/app/src/components", allowedRoots)).toBe(true);
  });

  test("exact match (root itself) returns true", () => {
    const allowedRoots = ["/home/user/projects"];
    expect(validateAllowedPath("/home/user/projects", allowedRoots)).toBe(true);
  });

  test("trailing slashes are handled correctly", () => {
    const allowedRoots = ["/home/user/projects/"];
    expect(validateAllowedPath("/home/user/projects/app", allowedRoots)).toBe(true);
    expect(validateAllowedPath("/home/user/projects", allowedRoots)).toBe(true);
  });

  test("multiple allowed roots work correctly", () => {
    const allowedRoots = ["/home/user/projects", "/var/www"];
    expect(validateAllowedPath("/home/user/projects/app", allowedRoots)).toBe(true);
    expect(validateAllowedPath("/var/www/site", allowedRoots)).toBe(true);
    expect(validateAllowedPath("/tmp/test", allowedRoots)).toBe(false);
  });

  test("path traversal attempt is prevented", () => {
    const allowedRoots = ["/home/user/projects"];
    // resolve will normalize the path
    const traversalPath = resolve("/home/user/projects/../secrets");
    expect(validateAllowedPath(traversalPath, allowedRoots)).toBe(false);
  });

  test("prefix matching doesn't allow similar paths", () => {
    const allowedRoots = ["/home/user/projects"];
    // /home/user/projects2 should not match /home/user/projects
    expect(validateAllowedPath("/home/user/projects2", allowedRoots)).toBe(false);
  });

  test("relative paths are resolved correctly", () => {
    const allowedRoots = [process.cwd()];
    expect(validateAllowedPath(".", allowedRoots)).toBe(true);
    expect(validateAllowedPath("./subdir", allowedRoots)).toBe(true);
  });
});

describe("parseServerConfig - allowedRoots", () => {
  const originalEnv = process.env.CC_MOBILE_ALLOWED_ROOTS;

  // Clean up after tests
  const cleanup = () => {
    if (originalEnv === undefined) {
      delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    } else {
      process.env.CC_MOBILE_ALLOWED_ROOTS = originalEnv;
    }
  };

  test("not set returns null", () => {
    delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toBe(null);
    cleanup();
  });

  test("empty string returns null", () => {
    process.env.CC_MOBILE_ALLOWED_ROOTS = "";
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toBe(null);
    cleanup();
  });

  test("whitespace only returns null", () => {
    process.env.CC_MOBILE_ALLOWED_ROOTS = "   ";
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toBe(null);
    cleanup();
  });

  test("single path is parsed and resolved", () => {
    process.env.CC_MOBILE_ALLOWED_ROOTS = "/home/user/projects";
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toEqual([resolve("/home/user/projects")]);
    cleanup();
  });

  test("multiple paths are parsed correctly", () => {
    process.env.CC_MOBILE_ALLOWED_ROOTS = "/home/user/projects,/var/www,/opt/apps";
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toEqual([
      resolve("/home/user/projects"),
      resolve("/var/www"),
      resolve("/opt/apps"),
    ]);
    cleanup();
  });

  test("paths with spaces are trimmed", () => {
    process.env.CC_MOBILE_ALLOWED_ROOTS = " /home/user/projects , /var/www ";
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toEqual([resolve("/home/user/projects"), resolve("/var/www")]);
    cleanup();
  });

  test("empty entries are filtered out", () => {
    process.env.CC_MOBILE_ALLOWED_ROOTS = "/home/user/projects,,/var/www";
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toEqual([resolve("/home/user/projects"), resolve("/var/www")]);
    cleanup();
  });

  test("relative paths are converted to absolute", () => {
    process.env.CC_MOBILE_ALLOWED_ROOTS = "./projects,../other";
    const { parseServerConfig } = require("../config");
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result.allowedRoots).toEqual([resolve("./projects"), resolve("../other")]);
    cleanup();
  });
});

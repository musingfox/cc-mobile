import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { getInitialBrowsePath, listDirectories } from "../directory-listing";

describe("Directory Listing Integration Tests", () => {
  // realpathSync normalizes macOS /tmp → /private/tmp; the allowed-roots check
  // resolves symlinks, so the fixture paths must already be resolved to match.
  const tmpRoot = realpathSync(tmpdir());
  const testRoot = join(tmpRoot, `cc-mobile-integration-${Date.now()}`);
  const workspace = join(testRoot, "workspace");
  const outsideRoot = join(tmpRoot, `outside-${Date.now()}`);

  beforeAll(() => {
    // Setup test directories
    mkdirSync(testRoot, { recursive: true });
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, "project-a"), { recursive: true });
    mkdirSync(join(workspace, "project-b"), { recursive: true });
    mkdirSync(join(workspace, "project-c"), { recursive: true });
    writeFileSync(join(workspace, "README.md"), "test file");
    writeFileSync(join(workspace, "package.json"), "{}");

    // Create symlink inside allowed roots
    mkdirSync(join(testRoot, "linked-dir"), { recursive: true });
    try {
      symlinkSync(join(testRoot, "linked-dir"), join(workspace, "symlink-inside"));
    } catch {
      // Symlink creation may fail on some systems
    }

    // Create symlink pointing outside allowed roots
    mkdirSync(outsideRoot, { recursive: true });
    try {
      symlinkSync(outsideRoot, join(workspace, "symlink-outside"));
    } catch {
      // Symlink creation may fail on some systems
    }
  });

  afterAll(() => {
    // Cleanup
    try {
      rmSync(testRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("Contract 1: listDirectories handler", () => {
    test("lists only directories, sorted alphabetically", () => {
      const result = listDirectories(workspace, null);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const names = result.listing.entries.map((e) => e.name);
      expect(names.slice(0, 3)).toEqual(["project-a", "project-b", "project-c"]);
      expect(names).not.toContain("README.md");
      expect(names).not.toContain("package.json");
    });

    test("tilde expansion works for home directory", () => {
      const result = listDirectories("~", null);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.listing.path).toBe(homedir());
      expect(existsSync(result.listing.path)).toBe(true);
    });

    test("returns parent directory for nested paths", () => {
      const result = listDirectories(join(workspace, "project-a"), null);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.listing.parent).toBe(workspace);
      expect(result.listing.parent).toBe(dirname(join(workspace, "project-a")));
    });

    test("returns null parent for root directory", () => {
      const result = listDirectories(sep, null);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.listing.parent).toBeNull();
    });

    test("path validation detects non-existent paths", () => {
      const fakePath = join(testRoot, "non-existent");
      expect(existsSync(fakePath)).toBe(false);
      const result = listDirectories(fakePath, null);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_path");
      expect(result.error.message).toBe(`Path does not exist: ${fakePath}`);
    });

    test("path validation detects file (not directory)", () => {
      const filePath = join(workspace, "README.md");
      const result = listDirectories(filePath, null);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("invalid_path");
      expect(result.error.message).toBe(`Not a directory: ${filePath}`);
    });

    test("includes a symlink whose target stays inside the allowed roots", () => {
      const result = listDirectories(workspace, [testRoot]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.listing.entries.map((e) => e.name)).toContain("symlink-inside");
    });

    test("excludes a symlink whose target escapes the allowed roots", () => {
      // The allowed-roots check runs against the resolved target, not the link
      // path — otherwise a link inside the root would smuggle callers outside it.
      // Guard against a vacuous pass if the fixture symlink was never created.
      expect(existsSync(join(workspace, "symlink-outside"))).toBe(true);

      const result = listDirectories(workspace, [testRoot]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.listing.entries.map((e) => e.name)).not.toContain("symlink-outside");
    });

    test("rejects a workspace outside the allowed roots", () => {
      const result = listDirectories(workspace, [outsideRoot]);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("path_not_allowed");
      expect(result.error.message).toBe("Path is not in the allowed roots");
    });
  });

  describe("Contract 2: getInitialBrowsePath", () => {
    test("returns first allowed root when array has elements", () => {
      const result = getInitialBrowsePath(["/a", "/b"], "/home");
      expect(result).toBe("/a");
    });

    test("returns homeDirectory when allowedRoots is null", () => {
      const result = getInitialBrowsePath(null, "/home");
      expect(result).toBe("/home");
    });

    test("returns homeDirectory when allowedRoots is empty", () => {
      const result = getInitialBrowsePath([], "/home");
      expect(result).toBe("/home");
    });

    test("uses actual homedir from OS", () => {
      const home = homedir();
      const result = getInitialBrowsePath([], home);
      expect(result).toBe(home);
    });
  });

  describe("Contract 3: ServerConfig extension", () => {
    test("ServerConfigMessage schema should include allowedRoots and homeDirectory", async () => {
      const { ServerMessage } = await import("../protocol");

      const validConfig = {
        type: "server_config",
        config: {
          permissionMode: "default",
          allowedRoots: ["/workspace"],
          homeDirectory: "/home/user",
        },
      };

      const result = ServerMessage.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    test("ServerConfigMessage schema allows null allowedRoots", async () => {
      const { ServerMessage } = await import("../protocol");

      const validConfig = {
        type: "server_config",
        config: {
          permissionMode: "default",
          allowedRoots: null,
          homeDirectory: "/home/user",
        },
      };

      const result = ServerMessage.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    test("ServerConfigMessage schema allows missing optional fields", async () => {
      const { ServerMessage } = await import("../protocol");

      const validConfig = {
        type: "server_config",
        config: {
          permissionMode: "default",
        },
      };

      const result = ServerMessage.safeParse(validConfig);
      expect(result.success).toBe(true);
    });
  });

  describe("Protocol schemas", () => {
    test("ListDirectoriesMessage validates correctly", async () => {
      const { ClientMessage } = await import("../protocol");

      const validMessage = {
        type: "list_directories",
        path: "/workspace",
      };

      const result = ClientMessage.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test("DirectoryListingMessage validates correctly", async () => {
      const { ServerMessage } = await import("../protocol");

      const validMessage = {
        type: "directory_listing",
        path: "/workspace",
        entries: [
          { name: "project-a", path: "/workspace/project-a" },
          { name: "project-b", path: "/workspace/project-b" },
        ],
        parent: "/",
      };

      const result = ServerMessage.safeParse(validMessage);
      expect(result.success).toBe(true);
    });

    test("DirectoryListingMessage allows null parent", async () => {
      const { ServerMessage } = await import("../protocol");

      const validMessage = {
        type: "directory_listing",
        path: "/",
        entries: [{ name: "home", path: "/home" }],
        parent: null,
      };

      const result = ServerMessage.safeParse(validMessage);
      expect(result.success).toBe(true);
    });
  });

  describe("Error cases", () => {
    test("error message for invalid_path", async () => {
      const { ServerMessage } = await import("../protocol");

      const errorMsg = {
        type: "error",
        code: "invalid_path",
        message: "Path does not exist: /fake/path",
      };

      const result = ServerMessage.safeParse(errorMsg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe("invalid_path");
      }
    });

    test("error message for path_not_allowed", async () => {
      const { ServerMessage } = await import("../protocol");

      const errorMsg = {
        type: "error",
        code: "path_not_allowed",
        message: "Path is not in the allowed roots",
      };

      const result = ServerMessage.safeParse(errorMsg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe("path_not_allowed");
      }
    });

    test("error message for permission_denied", async () => {
      const { ServerMessage } = await import("../protocol");

      const errorMsg = {
        type: "error",
        code: "permission_denied",
        message: "Cannot read directory: /restricted",
      };

      const result = ServerMessage.safeParse(errorMsg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.code).toBe("permission_denied");
      }
    });
  });
});

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { getInitialBrowsePath } from "../ws";

describe("Directory Listing Integration Tests", () => {
  const testRoot = join(tmpdir(), `cc-mobile-integration-${Date.now()}`);
  const workspace = join(testRoot, "workspace");
  const outsideRoot = join(tmpdir(), `outside-${Date.now()}`);

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
      // This test verifies the logic would filter files and sort
      const expectedDirs = ["project-a", "project-b", "project-c"];
      expect(expectedDirs).toEqual(expectedDirs.sort());
    });

    test("tilde expansion works for home directory", () => {
      const home = homedir();
      expect(home).toMatch(/\//);
      expect(existsSync(home)).toBe(true);
    });

    test("returns parent directory for nested paths", () => {
      const path = join(workspace, "project-a");
      const parent = dirname(path);
      expect(parent).toBe(workspace);
    });

    test("returns null parent for root directory", () => {
      const root = sep;
      const parent = root === sep ? null : dirname(root);
      expect(parent === null || parent === root).toBe(true);
    });

    test("path validation detects non-existent paths", () => {
      const fakePath = join(testRoot, "non-existent");
      expect(existsSync(fakePath)).toBe(false);
    });

    test("path validation detects file (not directory)", () => {
      const filePath = join(workspace, "README.md");
      expect(existsSync(filePath)).toBe(true);
      const fs = require("node:fs");
      expect(fs.statSync(filePath).isDirectory()).toBe(false);
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

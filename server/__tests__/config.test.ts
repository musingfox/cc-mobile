import { afterEach, describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseServerConfig } from "../config";

describe("parseServerConfig", () => {
  const originalEnv = process.env.CC_MOBILE_ALLOWED_ROOTS;

  // Clean up after each test
  const cleanup = () => {
    if (originalEnv === undefined) {
      delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    } else {
      process.env.CC_MOBILE_ALLOWED_ROOTS = originalEnv;
    }
  };

  test("defaults", () => {
    delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    delete process.env.BASE_PATH;
    delete process.env.CC_MOBILE_VAULT_ROOT;
    delete process.env.CC_MOBILE_HANGAR_CAP;
    const result = parseServerConfig(["node", "index.ts"]);
    expect(result).toEqual({
      port: 3001,
      hostname: "0.0.0.0",
      defaultCwd: null,
      allowedRoots: null,
      basePath: "",
      pushScope: "phone-last",
      hangarSession: null,
      launchToken: null,
      vaultRoot: null,
      hangarCap: 4,
    });
    cleanup();
  });

  test("all flags", () => {
    delete process.env.CC_MOBILE_ALLOWED_ROOTS;
    delete process.env.BASE_PATH;
    delete process.env.CC_MOBILE_VAULT_ROOT;
    delete process.env.CC_MOBILE_HANGAR_CAP;
    const result = parseServerConfig([
      "node",
      "index.ts",
      "--port",
      "4000",
      "--permission-mode",
      "acceptEdits",
      "--default-cwd",
      "/workspace",
    ]);
    expect(result).toEqual({
      port: 4000,
      hostname: "0.0.0.0",
      defaultCwd: "/workspace",
      allowedRoots: null,
      basePath: "",
      pushScope: "phone-last",
      hangarSession: null,
      launchToken: null,
      vaultRoot: null,
      hangarCap: 4,
    });
    cleanup();
  });

  test("invalid port", () => {
    expect(() => {
      parseServerConfig(["node", "index.ts", "--port", "abc"]);
    }).toThrow("Port must be a valid number");
  });

  describe("CC_MOBILE_VAULT_ROOT", () => {
    const original = process.env.CC_MOBILE_VAULT_ROOT;
    const parse = (v: string | undefined) => {
      if (v === undefined) delete process.env.CC_MOBILE_VAULT_ROOT;
      else process.env.CC_MOBILE_VAULT_ROOT = v;
      return parseServerConfig(["node", "index.ts"]).vaultRoot;
    };

    afterEach(() => {
      if (original === undefined) delete process.env.CC_MOBILE_VAULT_ROOT;
      else process.env.CC_MOBILE_VAULT_ROOT = original;
    });

    test("unset is null", () => {
      expect(parse(undefined)).toBeNull();
    });
    test("whitespace-only is null", () => {
      expect(parse("   ")).toBeNull();
    });
    test("value is trimmed", () => {
      expect(parse(" /Users/x/Documents/obsidian ")).toBe("/Users/x/Documents/obsidian");
    });
    test("leading ~ expands to home", () => {
      expect(parse("~/vault")).toBe(join(homedir(), "vault"));
    });
    test("trailing slash is dropped", () => {
      expect(parse("/x/obsidian/")).toBe("/x/obsidian");
    });
  });

  describe("CC_MOBILE_HANGAR_SESSION", () => {
    const original = process.env.CC_MOBILE_HANGAR_SESSION;
    const parse = (v: string | undefined) => {
      if (v === undefined) delete process.env.CC_MOBILE_HANGAR_SESSION;
      else process.env.CC_MOBILE_HANGAR_SESSION = v;
      return parseServerConfig(["node", "index.ts"]).hangarSession;
    };

    afterEach(() => {
      if (original === undefined) delete process.env.CC_MOBILE_HANGAR_SESSION;
      else process.env.CC_MOBILE_HANGAR_SESSION = original;
    });

    test("unset is null, not undefined", () => {
      expect(parse(undefined)).toBeNull();
    });
    test("whitespace-only is null", () => {
      expect(parse("   ")).toBeNull();
    });
    test("name is trimmed", () => {
      expect(parse(" fleet ")).toBe("fleet");
    });
    test("plain name passes", () => {
      expect(parse("fleet-2_x")).toBe("fleet-2_x");
    });
    test("@ throws naming the var and value", () => {
      expect(() => parse("fl@eet")).toThrow(/CC_MOBILE_HANGAR_SESSION/);
      expect(() => parse("fl@eet")).toThrow(/fl@eet/);
    });
    test.each([
      "a:b",
      "a/b",
      "a\\b",
      "my fleet",
      "a\tb",
      ".",
      "..",
      "fleet.v2",
      "機庫",
    ])("%j throws", (v) => {
      expect(() => parse(v)).toThrow(/CC_MOBILE_HANGAR_SESSION/);
    });
  });

  describe("CC_MOBILE_PUSH_SCOPE", () => {
    const original = process.env.CC_MOBILE_PUSH_SCOPE;

    afterEach(() => {
      if (original === undefined) delete process.env.CC_MOBILE_PUSH_SCOPE;
      else process.env.CC_MOBILE_PUSH_SCOPE = original;
    });

    test("unset means phone-last", () => {
      delete process.env.CC_MOBILE_PUSH_SCOPE;
      expect(parseServerConfig(["node", "index.ts"]).pushScope).toBe("phone-last");
    });

    test("all is accepted", () => {
      process.env.CC_MOBILE_PUSH_SCOPE = "all";
      expect(parseServerConfig(["node", "index.ts"]).pushScope).toBe("all");
    });

    test("a typo throws instead of silently defaulting", () => {
      // Falling back would leave the operator believing they had switched
      // something on, and a push that never arrives is already the hardest
      // failure here to see.
      process.env.CC_MOBILE_PUSH_SCOPE = "always";
      expect(() => parseServerConfig(["node", "index.ts"])).toThrow("CC_MOBILE_PUSH_SCOPE");
    });
  });

  describe("hangar cap from performance cores", () => {
    const original = process.env.CC_MOBILE_HANGAR_CAP;
    afterEach(() => {
      if (original === undefined) delete process.env.CC_MOBILE_HANGAR_CAP;
      else process.env.CC_MOBILE_HANGAR_CAP = original;
    });
    const capFor = (readPerfCores?: () => number | null) => {
      delete process.env.CC_MOBILE_HANGAR_CAP;
      return parseServerConfig(["node", "index.ts"], readPerfCores ? { readPerfCores } : undefined)
        .hangarCap;
    };

    test("6 cores -> 4", () => expect(capFor(() => 6)).toBe(4));
    test("10 cores -> 8", () => expect(capFor(() => 10)).toBe(8));
    test("3, 2 or 1 cores -> 1", () => {
      for (const n of [3, 2, 1]) expect(capFor(() => n)).toBe(1);
    });
    test("null -> 4", () => expect(capFor(() => null)).toBe(4));
    test("a throwing reader -> 4", () =>
      expect(
        capFor(() => {
          throw new Error("x");
        }),
      ).toBe(4));
    test("no options -> 4", () => expect(capFor()).toBe(4));
    test("reader is called exactly once", () => {
      let calls = 0;
      capFor(() => {
        calls++;
        return 6;
      });
      expect(calls).toBe(1);
    });
  });
});

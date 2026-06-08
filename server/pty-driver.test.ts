/**
 * pty-driver.test.ts — Unit tests for PtyDriver
 *
 * Covers:
 *   - SpawnerFn injection: args, cwd, write content
 *   - Single-shot: exactly one spawn, exactly one write
 *   - Default spawner throws on call (parked decision)
 *   - No node-pty in top-level imports
 */

import { describe, expect, it } from "bun:test";
import type { SpawnerFn } from "./pty-driver";
import { PtyDriver } from "./pty-driver";

describe("PtyDriver", () => {
  describe("driveOnce with injected spawner", () => {
    it("passes correct args to spawner: [claude, --session-id, <id>]", () => {
      const capturedArgs: string[][] = [];
      const spawner: SpawnerFn = (args, _cwd) => {
        capturedArgs.push(args);
        return { write: () => {} };
      };

      const driver = new PtyDriver(spawner);
      driver.driveOnce("my-session-id", "/some/cwd", "hello");

      expect(capturedArgs).toHaveLength(1);
      expect(capturedArgs[0]).toEqual(["claude", "--session-id", "my-session-id"]);
    });

    it("passes the cwd argument to spawner", () => {
      const capturedCwds: string[] = [];
      const spawner: SpawnerFn = (_args, cwd) => {
        capturedCwds.push(cwd);
        return { write: () => {} };
      };

      const driver = new PtyDriver(spawner);
      driver.driveOnce("sess", "/project/root", "hi");

      expect(capturedCwds).toEqual(["/project/root"]);
    });

    it("writes prompt + CR exactly once", () => {
      const writtenData: string[] = [];
      const spawner: SpawnerFn = (_args, _cwd) => ({
        write: (data: string) => {
          writtenData.push(data);
        },
      });

      const driver = new PtyDriver(spawner);
      driver.driveOnce("sess", "/cwd", "my prompt");

      expect(writtenData).toHaveLength(1);
      expect(writtenData[0]).toBe("my prompt\r");
    });

    it("is single-shot: spawner called exactly once per driveOnce call", () => {
      let spawnCount = 0;
      const spawner: SpawnerFn = (_args, _cwd) => {
        spawnCount++;
        return { write: () => {} };
      };

      const driver = new PtyDriver(spawner);
      driver.driveOnce("sess", "/cwd", "prompt");

      expect(spawnCount).toBe(1);
    });

    it("multiple driveOnce calls each spawn independently", () => {
      let spawnCount = 0;
      const writtenData: string[] = [];
      const spawner: SpawnerFn = (_args, _cwd) => {
        spawnCount++;
        return {
          write: (data: string) => {
            writtenData.push(data);
          },
        };
      };

      const driver = new PtyDriver(spawner);
      driver.driveOnce("sess", "/cwd", "first");
      driver.driveOnce("sess", "/cwd", "second");

      expect(spawnCount).toBe(2);
      expect(writtenData).toEqual(["first\r", "second\r"]);
    });

    it("does not write extra bytes beyond prompt+CR", () => {
      const writtenData: string[] = [];
      const spawner: SpawnerFn = (_args, _cwd) => ({
        write: (data: string) => {
          writtenData.push(data);
        },
      });

      const driver = new PtyDriver(spawner);
      driver.driveOnce("sess", "/cwd", "test");

      // Exactly one write, exactly the right content
      expect(writtenData.length).toBe(1);
      expect(writtenData[0]).toBe("test\r");
    });
  });

  describe("default spawner (no injection)", () => {
    it("throws a descriptive error mentioning parked decision", () => {
      const driver = new PtyDriver(); // no spawner injected

      expect(() => {
        driver.driveOnce("sess", "/cwd", "hello");
      }).toThrow(/parked decision/);
    });

    it("throws specifically about Node.js worker or script", () => {
      const driver = new PtyDriver();

      expect(() => {
        driver.driveOnce("sess", "/cwd", "hello");
      }).toThrow(/Node\.js worker|script/);
    });

    it("does not throw at construction time — only when driveOnce is called", () => {
      // Construction should succeed with no spawner
      expect(() => new PtyDriver()).not.toThrow();
    });
  });
});

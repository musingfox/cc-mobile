import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { perFrameReady, settleDecision, settleLoop } from "../tui-capture-readiness";

const fixture = (name: string) =>
  readFileSync(join(import.meta.dir, "fixtures/tui-capture", name), "utf8");

describe("PerFrameReady", () => {
  test('T1: given empty string "" -> expect false', () => {
    expect(perFrameReady("")).toBe(false);
  });

  test("T2: given blank/splash frame with no banner text -> expect false", () => {
    const blank = fixture("blank.txt");
    expect(perFrameReady(blank)).toBe(false);
  });

  test("T3: given welcome-banner frame containing 'Claude Code' -> expect true", () => {
    const banner = fixture("banner-0.txt");
    expect(perFrameReady(banner)).toBe(true);
  });

  test("T4: given settled frame containing '╭' border -> expect true", () => {
    const settled = fixture("settled.txt");
    expect(perFrameReady(settled)).toBe(true);
  });
});

describe("SettleDecision", () => {
  const b0 = fixture("banner-0.txt");
  const b1 = fixture("banner-1.txt");
  const b2 = fixture("banner-2.txt");
  const settled = fixture("settled.txt");
  const blank = fixture("blank.txt");

  test("T1: given [bannerA,bannerB,bannerC,settled,settled,settled] banners classifier-ready but mutually different, settled x3 identical, stableCount=3 -> expect {ready:true, readyAtIndex:5}", () => {
    const frames = [b0, b1, b2, settled, settled, settled];
    expect(settleDecision(frames, 3)).toEqual({ ready: true, readyAtIndex: 5 });
  });

  test('T2: given ["","",""] -> expect {ready:false, readyAtIndex:null}', () => {
    expect(settleDecision(["", "", ""], 3)).toEqual({ ready: false, readyAtIndex: null });
  });

  test("T3: given [settled,settled,settled] identical ready frames, stableCount=3 -> expect {ready:true, readyAtIndex:2}", () => {
    const frames = [settled, settled, settled];
    expect(settleDecision(frames, 3)).toEqual({ ready: true, readyAtIndex: 2 });
  });

  test("T4: given [settled,settled,mutated,settled,settled,settled] stableCount=3 -> expect {ready:true, readyAtIndex:5}", () => {
    const mutated = b1; // different from settled
    const frames = [settled, settled, mutated, settled, settled, settled];
    expect(settleDecision(frames, 3)).toEqual({ ready: true, readyAtIndex: 5 });
  });

  test("T5: given [settled,settled] stableCount=3 -> expect {ready:false, readyAtIndex:null}", () => {
    const frames = [settled, settled];
    expect(settleDecision(frames, 3)).toEqual({ ready: false, readyAtIndex: null });
  });
});

describe("SettleLoop", () => {
  const b0 = fixture("banner-0.txt");
  const b1 = fixture("banner-1.txt");
  const settled = fixture("settled.txt");

  test("T1: given fake capture yields banner x2 then identical settled x3, stableCount=3 -> expect {ready:true, reason:'stable'}", async () => {
    let i = 0;
    const seq = [b0, b1, settled, settled, settled];
    const fake = async () => seq[i++] ?? settled;
    const res = await settleLoop({
      capture: fake,
      stableCount: 3,
      pollIntervalMs: 1,
      timeoutMs: 100,
    });
    expect(res).toEqual({ ready: true, reason: "stable" });
  });

  test("T2: given fake capture always yields a different mutating frame, timeoutMs=2000 pollIntervalMs=500 -> expect {ready:false, reason:'timeout'}", async () => {
    let i = 0;
    const fake = async () => `mutating-frame-${i++}`; // never identical
    const res = await settleLoop({ capture: fake, pollIntervalMs: 5, timeoutMs: 30 });
    expect(res).toEqual({ ready: false, reason: "timeout" });
  });

  test("T3: given fake capture returns null on 2nd poll -> expect {ready:false, reason:'session_gone'}", async () => {
    let i = 0;
    const fake = async () => (i++ === 1 ? null : settled);
    const res = await settleLoop({ capture: fake, pollIntervalMs: 1, timeoutMs: 100 });
    expect(res).toEqual({ ready: false, reason: "session_gone" });
  });
});

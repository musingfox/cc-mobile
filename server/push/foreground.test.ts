import { describe, expect, test } from "bun:test";
import { createForegroundTracker, FOREGROUND_FRESH_MS } from "./foreground";

function build() {
  let now = 1_000_000;
  const tracker = createForegroundTracker({ now: () => now });
  return {
    tracker,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("ForegroundTracker", () => {
  test("a device nobody reported is not foreground", () => {
    expect(build().tracker.isForeground("phone-a")).toBe(false);
  });

  test("a fresh visible report makes its device foreground, and only that device", () => {
    const { tracker } = build();
    tracker.report("c1", "phone-a", "visible");
    expect(tracker.isForeground("phone-a")).toBe(true);
    expect(tracker.isForeground("phone-b")).toBe(false);
  });

  test("a hidden report is not foreground", () => {
    const { tracker } = build();
    tracker.report("c1", "phone-a", "visible");
    tracker.report("c1", "phone-a", "hidden");
    expect(tracker.isForeground("phone-a")).toBe(false);
  });

  test("a visible report expires unless repeated", () => {
    const h = build();
    h.tracker.report("c1", "phone-a", "visible");
    h.advance(FOREGROUND_FRESH_MS - 1);
    expect(h.tracker.isForeground("phone-a")).toBe(true);
    h.advance(1);
    expect(h.tracker.isForeground("phone-a")).toBe(false);
    h.tracker.report("c1", "phone-a", "visible");
    expect(h.tracker.isForeground("phone-a")).toBe(true);
  });

  test("a closed connection is not foreground", () => {
    const { tracker } = build();
    tracker.report("c1", "phone-a", "visible");
    tracker.drop("c1");
    expect(tracker.isForeground("phone-a")).toBe(false);
  });

  test("the late close of an old connection keeps what the new one reported", () => {
    const { tracker } = build();
    tracker.report("old", "phone-a", "visible");
    tracker.report("new", "phone-a", "visible");
    tracker.drop("old");
    expect(tracker.isForeground("phone-a")).toBe(true);
  });

  test("one visible connection is enough when another of the device is hidden", () => {
    const { tracker } = build();
    tracker.report("c1", "phone-a", "hidden");
    tracker.report("c2", "phone-a", "visible");
    expect(tracker.isForeground("phone-a")).toBe(true);
  });

  test("a connection without a device name is not tracked", () => {
    const { tracker } = build();
    tracker.report("c1", null, "visible");
    expect(tracker.isForeground("")).toBe(false);
  });
});

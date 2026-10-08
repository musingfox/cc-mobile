import { describe, expect, test } from "bun:test";
import { HerdrProtocolError, HerdrTransportError } from "./errors";
import { createSocketWatch } from "./socket-watch";

const PATH = "/tmp/hangar.sock";

function rig(
  probe: (t: number) => Promise<unknown>,
  extra: Partial<Parameters<typeof createSocketWatch>[0]> = {},
) {
  let t = 0;
  let tickFn: (() => void) | undefined;
  let setCalls = 0;
  const warns: string[] = [];
  const watch = createSocketWatch({
    side: "hangar",
    socketPath: PATH,
    probe: () => probe(t),
    intervalMs: 10_000,
    now: () => t,
    setIntervalFn: (fn) => {
      setCalls++;
      tickFn = fn;
      return 1;
    },
    clearIntervalFn: () => {
      tickFn = undefined;
    },
    warn: (m) => warns.push(m),
    ...extra,
  });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return {
    watch,
    warns,
    setCalls: () => setCalls,
    at: async (ms: number) => {
      t = ms;
      tickFn?.();
      await settle();
    },
    start: async () => {
      watch.start();
      await settle();
    },
  };
}

const down = () => Promise.reject(new HerdrTransportError("ENOENT"));

describe("SocketWatchTracksReachability", () => {
  test("T1 unknown before start", () => {
    expect(rig(() => Promise.resolve()).watch.status()).toBe("unknown");
  });
  test("T2 online after a resolving probe", async () => {
    const r = rig(() => Promise.resolve());
    await r.start();
    expect(r.watch.status()).toBe("online");
  });
  test("T3 unreachable warns once with side and path", async () => {
    const r = rig(down);
    await r.start();
    await r.at(10_000);
    await r.at(20_000);
    expect(r.watch.status()).toBe("unreachable");
    expect(r.warns).toHaveLength(1);
    expect(r.warns[0]).toContain("hangar");
    expect(r.warns[0]).toContain(PATH);
  });
  test("T4 protocol error is incompatible", async () => {
    const r = rig(() => Promise.reject(new HerdrProtocolError("v9")));
    await r.start();
    expect(r.watch.status()).toBe("incompatible");
    expect(r.warns[0]).toContain("protocol");
    expect(r.warns[0]).toContain(PATH);
  });
  test("T5 warns on down, recovered, down", async () => {
    const outcomes = [false, false, true, false];
    let i = 0;
    const r = rig(() => (outcomes[i++] ? Promise.resolve() : down()));
    await r.start();
    await r.at(10_000);
    await r.at(20_000);
    await r.at(30_000);
    expect(r.warns).toHaveLength(3);
  });
  test("T6 stop halts probing", async () => {
    let calls = 0;
    const r = rig(() => {
      calls++;
      return Promise.resolve();
    });
    await r.start();
    await r.at(10_000);
    await r.at(20_000);
    r.watch.stop();
    await r.at(30_000);
    expect(calls).toBe(3);
  });
  test("T7 skips a tick while a probe is in flight", async () => {
    let calls = 0;
    const r = rig(() => {
      calls++;
      return new Promise(() => {});
    });
    await r.start();
    await r.at(10_000);
    await r.at(20_000);
    expect(calls).toBe(1);
  });
  test("T8 start twice installs one interval", async () => {
    const r = rig(() => Promise.resolve());
    await r.start();
    await r.start();
    expect(r.setCalls()).toBe(1);
  });
  test("production interval is unref'd and stoppable", async () => {
    const watch = createSocketWatch({
      side: "hangar",
      socketPath: PATH,
      probe: () => Promise.resolve(),
      warn: () => {},
    });
    watch.start();
    watch.stop();
  });
});

describe("HangarOfflineAlarmOncePerEpisode", () => {
  function alarmRig(
    probe: (t: number) => Promise<unknown>,
    onAlarm?: () => Promise<unknown> | void,
  ) {
    let alarms = 0;
    const r = rig(probe, {
      offlineAlarm: {
        afterMs: 300_000,
        onAlarm:
          onAlarm ??
          (() => {
            alarms++;
          }),
      },
    });
    return { r, alarms: () => alarms };
  }
  async function run(r: ReturnType<typeof rig>, from: number, to: number) {
    for (let t = from; t <= to; t += 10_000) await (t === 0 ? r.start() : r.at(t));
  }

  test("T1 one alarm at 300s, none again", async () => {
    const { r, alarms } = alarmRig(down);
    await run(r, 0, 290_000);
    expect(alarms()).toBe(0);
    await r.at(300_000);
    expect(alarms()).toBe(1);
    await run(r, 310_000, 900_000);
    expect(alarms()).toBe(1);
  });
  test("T2 an online probe starts a new episode", async () => {
    const { r, alarms } = alarmRig((t) => (t === 210_000 ? Promise.resolve() : down()));
    await run(r, 0, 510_000);
    expect(alarms()).toBe(0);
    await r.at(520_000);
    expect(alarms()).toBe(1);
  });
  test("T3 no recovery alarm", async () => {
    const { r, alarms } = alarmRig((t) => (t >= 610_000 ? Promise.resolve() : down()));
    await run(r, 0, 600_000);
    expect(alarms()).toBe(1);
    await run(r, 610_000, 700_000);
    expect(alarms()).toBe(1);
  });
  test("T4 protocol error counts as offline", async () => {
    const { r, alarms } = alarmRig(() => Promise.reject(new HerdrProtocolError("v9")));
    await run(r, 0, 300_000);
    expect(alarms()).toBe(1);
  });
  test("T5 a rejecting onAlarm is warned and probing continues", async () => {
    let probes = 0;
    const { r } = alarmRig(
      () => {
        probes++;
        return down();
      },
      () => Promise.reject(new Error("push down")),
    );
    await run(r, 0, 300_000);
    await r.at(310_000);
    expect(r.warns.some((w) => /push down/.test(w))).toBe(true);
    expect(probes).toBe(32);
  });
  test("T6 no offlineAlarm: nothing happens", async () => {
    const r = rig(down);
    await run(r, 0, 900_000);
    expect(r.watch.status()).toBe("unreachable");
  });
});

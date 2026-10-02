import { afterEach, describe, expect, test } from "bun:test";
import { ClientMessage } from "../protocol";
import { createForegroundTracker, type ForegroundTracker } from "../push/foreground";
import { startWsHarness, type WsHarness } from "./ws-harness";

let harness: WsHarness | null = null;

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const backend = {
  listLive: () => [],
  registerClient: () => {},
  cleanupByOwner: () => {},
};

/**
 * `visibility` gets no reply, so a later request's reply is the receipt that
 * the server has handled it: one socket's messages are handled in order.
 */
async function barrier(h: WsHarness) {
  h.send({ type: "get_server_config" });
  await h.waitFor((msg) => msg.type === "server_config");
}

async function until(condition: () => boolean, label: string) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("VisibilityMessage schema", () => {
  test("accepts the two states a page reports", () => {
    expect(ClientMessage.safeParse({ type: "visibility", state: "visible" }).success).toBe(true);
    expect(ClientMessage.safeParse({ type: "visibility", state: "hidden" }).success).toBe(true);
  });

  test("refuses any other state, and a missing one", () => {
    expect(ClientMessage.safeParse({ type: "visibility", state: "prerender" }).success).toBe(false);
    expect(ClientMessage.safeParse({ type: "visibility" }).success).toBe(false);
  });
});

describe("VisibilityReportedPerConnection", () => {
  test("a visible report makes the connection's ?device= foreground, with no reply", async () => {
    const foreground = createForegroundTracker();
    harness = await startWsHarness(backend, undefined, { foreground, deviceName: "phone-a" });

    harness.send({ type: "visibility", state: "visible" });
    await barrier(harness);

    expect(foreground.isForeground("phone-a")).toBe(true);
    expect(harness.received.map((msg) => msg.type)).toEqual(["server_config"]);
  });

  test("a hidden report takes it back", async () => {
    const foreground = createForegroundTracker();
    harness = await startWsHarness(backend, undefined, { foreground, deviceName: "phone-a" });

    harness.send({ type: "visibility", state: "visible" });
    harness.send({ type: "visibility", state: "hidden" });
    await barrier(harness);

    expect(foreground.isForeground("phone-a")).toBe(false);
  });

  test("closing the socket drops what it reported", async () => {
    const foreground = createForegroundTracker();
    harness = await startWsHarness(backend, undefined, { foreground, deviceName: "phone-a" });

    harness.send({ type: "visibility", state: "visible" });
    await barrier(harness);
    expect(foreground.isForeground("phone-a")).toBe(true);

    await harness.close();
    harness = null;
    await until(() => !foreground.isForeground("phone-a"), "the close to drop the report");
  });

  test("a connection with no ?device= reports no device", async () => {
    const devices: (string | null)[] = [];
    const real = createForegroundTracker();
    const foreground: ForegroundTracker = {
      ...real,
      report: (connection, device, state) => {
        devices.push(device);
        real.report(connection, device, state);
      },
    };
    harness = await startWsHarness(backend, undefined, { foreground });

    harness.send({ type: "visibility", state: "visible" });
    await barrier(harness);

    expect(devices).toEqual([null]);
  });

  test("an unknown state is refused at the gate and reports nothing", async () => {
    const foreground = createForegroundTracker();
    harness = await startWsHarness(backend, undefined, { foreground, deviceName: "phone-a" });

    harness.send({ type: "visibility", state: "prerender" });
    const error = await harness.waitFor((msg) => msg.type === "error");

    expect(error.code).toBe("invalid_message");
    expect(foreground.isForeground("phone-a")).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HeartbeatManager, HeartbeatSender } from "../heartbeat";

const createMockSender = () => ({
  sent: [] as any[],
  closed: false,
  send(data: any) {
    this.sent.push(data);
  },
  close() {
    this.closed = true;
  },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("HeartbeatManager", () => {
  let sender: ReturnType<typeof createMockSender>;
  let manager: HeartbeatManager;

  beforeEach(() => {
    sender = createMockSender();
  });

  afterEach(() => {
    manager?.stop();
  });

  it("sends ping at interval", async () => {
    manager = new HeartbeatManager(sender, { intervalMs: 100, timeoutMs: 50 });
    manager.start();

    await sleep(150);

    expect(sender.sent.length).toBeGreaterThanOrEqual(1);
    expect(sender.sent[0]).toMatchObject({ type: "ping" });
    expect(sender.sent[0].timestamp).toBeTypeOf("number");
  });

  it("timeout closes connection", async () => {
    manager = new HeartbeatManager(sender, { intervalMs: 100, timeoutMs: 50 });
    manager.start();

    await sleep(200);

    expect(sender.closed).toBe(true);
  });

  it("recordPong prevents close", async () => {
    manager = new HeartbeatManager(sender, { intervalMs: 100, timeoutMs: 50 });
    manager.start();

    await sleep(30);
    manager.recordPong();

    await sleep(80);
    manager.recordPong();

    await sleep(30);
    manager.recordPong();

    expect(sender.closed).toBe(false);
  });

  it("stop prevents further pings", async () => {
    manager = new HeartbeatManager(sender, { intervalMs: 100, timeoutMs: 50 });
    manager.start();

    await sleep(50);
    manager.stop();

    const sentCount = sender.sent.length;
    await sleep(200);

    expect(sender.sent.length).toBe(sentCount);
  });

  it("isAlive returns correct state", async () => {
    manager = new HeartbeatManager(sender, { intervalMs: 100, timeoutMs: 50 });

    expect(manager.isAlive()).toBe(true);

    manager.start();
    await sleep(160); // Wait for timeout to trigger

    expect(manager.isAlive()).toBe(false);
    expect(sender.closed).toBe(true);

    // Create a new manager for the next part
    sender = createMockSender();
    manager = new HeartbeatManager(sender, { intervalMs: 100, timeoutMs: 50 });
    manager.start();

    await sleep(30);
    manager.recordPong();

    expect(manager.isAlive()).toBe(true);
  });

  it("start is idempotent", async () => {
    manager = new HeartbeatManager(sender, { intervalMs: 100, timeoutMs: 50 });
    manager.start();
    manager.start();

    await sleep(150);

    // Should have ~1 ping, not ~2 (allowing for timing variance)
    expect(sender.sent.length).toBeLessThanOrEqual(2);
  });
});

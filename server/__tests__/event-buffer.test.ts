import { describe, expect, it } from "bun:test";
import { EventBuffer } from "../event-buffer";

describe("EventBuffer", () => {
  it("append assigns sequential IDs", () => {
    const buffer = new EventBuffer();
    const m1 = { type: "test1" };
    const m2 = { type: "test2" };

    const id1 = buffer.append("s1", m1);
    const id2 = buffer.append("s1", m2);

    expect(id1).toBe(1);
    expect(id2).toBe(2);
  });

  it("replay returns events after lastEventId", () => {
    const buffer = new EventBuffer();
    const m1 = { type: "test1" };
    const m2 = { type: "test2" };

    buffer.append("s1", m1);
    buffer.append("s1", m2);

    const events = buffer.replay("s1", 1);

    expect(events.length).toBe(1);
    expect(events[0].eventId).toBe(2);
    expect(events[0].message).toEqual(m2);
  });

  it("buffer overflow drops oldest", () => {
    const buffer = new EventBuffer(2);
    const m1 = { type: "test1" };
    const m2 = { type: "test2" };
    const m3 = { type: "test3" };

    buffer.append("s1", m1);
    buffer.append("s1", m2);
    buffer.append("s1", m3);

    const stats = buffer.getStats("s1");

    expect(stats.count).toBe(2);
    expect(stats.oldest).toBe(2);
    expect(stats.newest).toBe(3);
  });

  it("multi-session isolation", () => {
    const buffer = new EventBuffer();
    const m1 = { type: "test1" };
    const m2 = { type: "test2" };

    buffer.append("s1", m1);
    buffer.append("s2", m2);

    const events = buffer.replay("s1", 0);

    expect(events.length).toBe(1);
    expect(events[0].message).toEqual(m1);
  });

  it("replay with purged afterEventId returns all available", () => {
    const buffer = new EventBuffer(3);

    buffer.append("s1", { type: "m1" });
    buffer.append("s1", { type: "m2" });
    buffer.append("s1", { type: "m3" });
    buffer.append("s1", { type: "m4" });
    buffer.append("s1", { type: "m5" });

    const events = buffer.replay("s1", 1);

    expect(events.length).toBe(3);
    expect(events[0].eventId).toBe(3);
    expect(events[1].eventId).toBe(4);
    expect(events[2].eventId).toBe(5);
  });

  it("clear removes session data", () => {
    const buffer = new EventBuffer();
    const m1 = { type: "test1" };

    buffer.append("s1", m1);
    buffer.clear("s1");

    const events = buffer.replay("s1", 0);
    const latestId = buffer.getLatestEventId("s1");

    expect(events).toEqual([]);
    expect(latestId).toBeNull();
  });

  it("unknown session returns empty", () => {
    const buffer = new EventBuffer();

    const events = buffer.replay("nonexistent", 0);
    const latestId = buffer.getLatestEventId("nonexistent");
    const stats = buffer.getStats("nonexistent");

    expect(events).toEqual([]);
    expect(latestId).toBeNull();
    expect(stats).toEqual({ count: 0, oldest: null, newest: null });
  });
});

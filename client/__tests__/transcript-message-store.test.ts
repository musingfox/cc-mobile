import { beforeEach, describe, expect, test } from "bun:test";
import { useAppStore } from "../stores/app-store";

describe("transcript message store (upsert/ordering/epoch)", () => {
  beforeEach(() => {
    useAppStore.setState({ sessions: new Map(), activeSessionId: null });
  });

  test("RetiredEpochChunkIgnored T1: epoch aaaa then bbbb (reset) then replay aaaa -> 1 msg, epoch bbbb", () => {
    const s = useAppStore.getState();
    s.addSession("s1", "/c");
    s["applyTranscriptChunk"]?.("s1", { epoch: "aaaa", recordId: "r1", seq: 1, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "a" }] } } as any);
    s["applyTranscriptChunk"]?.("s1", { epoch: "bbbb", recordId: "r2", seq: 0, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "b" }] } } as any);
    s["applyTranscriptChunk"]?.("s1", { epoch: "aaaa", recordId: "r3", seq: 2, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "old" }] } } as any);
    const msgs = useAppStore.getState().sessions.get("s1")!.messages;
    expect(msgs.length).toBe(1);
    expect(useAppStore.getState().sessions.get("s1")!.epoch).toBe("bbbb");
  });

  test("TranscriptEpochReset T1: 4 msgs aaaa, chunk bbbb -> 1 msg, epoch bbbb", () => {
    const s = useAppStore.getState();
    s.addSession("s1", "/c");
    for (let i=0;i<4;i++) s.addMessage("s1", { id: "m"+i, role: "assistant", content: "x", timestamp: i });
    // simulate epoch set
    (useAppStore.getState().sessions.get("s1") as any).epoch = "aaaa";
    s["applyTranscriptChunk"]?.("s1", { epoch: "bbbb", recordId: "n1", seq: 0, type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "new" }] } } as any);
    const st = useAppStore.getState().sessions.get("s1")!;
    expect(st.messages.length).toBe(1);
    expect(st.epoch).toBe("bbbb");
  });

  test("TranscriptMessageOrdering T1: apply 300 then 100 then 200 -> order [100,200,300]", () => {
    const s = useAppStore.getState();
    s.addSession("s1", "/c");
    s["applyTranscriptChunk"]?.("s1", { recordId: "a", seq: 300, type: "assistant", message: { role: "assistant", content: "3" } } as any);
    s["applyTranscriptChunk"]?.("s1", { recordId: "b", seq: 100, type: "assistant", message: { role: "assistant", content: "1" } } as any);
    s["applyTranscriptChunk"]?.("s1", { recordId: "c", seq: 200, type: "assistant", message: { role: "assistant", content: "2" } } as any);
    const ids = useAppStore.getState().sessions.get("s1")!.messages.map(m => m.seq);
    expect(ids).toEqual([100, 200, 300]);
  });

  test("TranscriptMessageUpsert T1: same recordId twice -> 1 msg", () => {
    const s = useAppStore.getState();
    s.addSession("s1", "/c");
    s["applyTranscriptChunk"]?.("s1", { recordId: "u1", seq: 100, type: "assistant", message: { role: "assistant", content: "x" } } as any);
    s["applyTranscriptChunk"]?.("s1", { recordId: "u1", seq: 100, type: "assistant", message: { role: "assistant", content: "x" } } as any);
    expect(useAppStore.getState().sessions.get("s1")!.messages.length).toBe(1);
  });

  test("TranscriptEpochAbsenceIgnored T1: null->value no wipe", () => {
    const s = useAppStore.getState();
    s.addSession("s1", "/c");
    s.addMessage("s1", { id: "l", role: "user", content: "local", timestamp: 1 });
    s["applyTranscriptChunk"]?.("s1", { epoch: "aaaa", recordId: "r", seq: 0, type: "assistant", message: { role: "assistant", content: "new" } } as any);
    const st = useAppStore.getState().sessions.get("s1")!;
    expect(st.messages.length).toBe(2); // local + new, no wipe
    expect(st.epoch).toBe("aaaa");
  });
});

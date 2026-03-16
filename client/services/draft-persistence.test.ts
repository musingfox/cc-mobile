import { beforeEach, describe, expect, test } from "bun:test";
import { clearDraft, loadDraft, saveDraft } from "./draft-persistence";

describe("draft-persistence", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
  });

  test("saveDraft/loadDraft roundtrip works", () => {
    saveDraft("s1", "hello");
    const loaded = loadDraft("s1");
    expect(loaded).toBe("hello");
  });

  test("loadDraft returns empty string for nonexistent", () => {
    const loaded = loadDraft("nonexistent");
    expect(loaded).toBe("");
  });

  test("clearDraft removes the draft", () => {
    saveDraft("s1", "hello");
    clearDraft("s1");
    const loaded = loadDraft("s1");
    expect(loaded).toBe("");
  });

  test("localStorage key format is correct", () => {
    saveDraft("test-session", "content");
    const key = "ccm:draft:test-session";
    expect(localStorage.getItem(key)).toBe("content");
  });

  test("multiple sessions have independent drafts", () => {
    saveDraft("s1", "draft1");
    saveDraft("s2", "draft2");

    expect(loadDraft("s1")).toBe("draft1");
    expect(loadDraft("s2")).toBe("draft2");
  });

  test("clearing one session does not affect others", () => {
    saveDraft("s1", "draft1");
    saveDraft("s2", "draft2");

    clearDraft("s1");

    expect(loadDraft("s1")).toBe("");
    expect(loadDraft("s2")).toBe("draft2");
  });
});

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import ChatScreen from "../components/linear/ChatScreen";
import { selectConversationMessages } from "../services/conversation-mode";
import {
  messagesFromProjectedChunk,
  type ProjectedPart,
  projectChunk,
} from "../services/transcript-projection";
import { useAppStore } from "../stores/app-store";
import { useSettingsStore } from "../stores/settings-store";

/**
 * SystemInjectedUserRecords — claude writes some user-role records itself: a
 * background task finishing, a teammate or subagent reporting, another session
 * writing in. They rendered as "YOU" bubbles full of XML (audit 2026-10-03 #12)
 * though the person typed none of them. They show as a muted note instead —
 * still a turn boundary, because claude answers each one.
 */

/** Verbatim shape from a live transcript, 2026-10. */
const TASK_NOTIFICATION =
  '<task-notification>\n<task-id>b9v0wk3m4</task-id>\n<tool-use-id>toolu_01G9</tool-use-id>\n<output-file>/private/tmp/x/tasks/b9v0wk3m4.output</output-file>\n<status>completed</status>\n<summary>Background command "probe providers" completed (exit code 0)</summary>\n</task-notification>';
const TEAMMATE_MESSAGE =
  '<teammate-message teammate_id="team-lead" summary="Cold-read the résumé">\nYou are a recruiter…\n</teammate-message>';

const userRecord = (content: unknown, recordId = "u1", seq = 10) => ({
  type: "user",
  message: { role: "user", content },
  recordId,
  seq,
});

describe("SystemInjectedUserRecords", () => {
  test("a task notification is a note carrying its summary, not its markup", () => {
    expect(projectChunk(userRecord(TASK_NOTIFICATION))).toEqual([
      {
        kind: "system_note",
        text: 'Background task · Background command "probe providers" completed (exit code 0)',
      },
    ]);
  });

  test("a teammate message is a note, in string or block form", () => {
    const note: ProjectedPart[] = [
      { kind: "system_note", text: "Teammate message · Cold-read the résumé" },
    ];
    expect(projectChunk(userRecord(TEAMMATE_MESSAGE))).toEqual(note);
    expect(projectChunk(userRecord([{ type: "text", text: TEAMMATE_MESSAGE }]))).toEqual(note);
  });

  test("text the person typed is untouched, even when it mentions a wrapper", () => {
    expect(projectChunk(userRecord("why did <task-notification> show up?"))).toEqual([
      { kind: "text", text: "why did <task-notification> show up?" },
    ]);
  });

  test("conversation mode keeps the note and the answer it got", () => {
    const [prompt] = messagesFromProjectedChunk(userRecord("start the job"), () => "m1");
    const answer1 = {
      id: "a1",
      role: "assistant" as const,
      content: "Started it.",
      timestamp: 0,
      stopReason: "end_turn",
    };
    const [note] = messagesFromProjectedChunk(userRecord(TASK_NOTIFICATION, "u2", 30), () => "m2");
    const answer2 = { ...answer1, id: "a2", content: "The job finished." };

    expect(note.kind).toBe("system_note");
    expect(selectConversationMessages([prompt, answer1, note, answer2])).toEqual([
      prompt,
      answer1,
      note,
      answer2,
    ]);
  });
});

describe("SystemNoteRendering", () => {
  const initialReadingMode = useSettingsStore.getState().readingMode;

  beforeEach(() => {
    useSettingsStore.setState({ readingMode: "conversation" });
    useAppStore.setState({ sessions: new Map(), activeSessionId: null, inputDraft: "" });
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState({ readingMode: initialReadingMode });
  });

  test("renders as a muted note, never as the person's bubble", () => {
    const store = useAppStore.getState();
    store.addSession("s1", "/tmp/project");
    const [note] = messagesFromProjectedChunk(userRecord(TASK_NOTIFICATION), () => "n1");
    store.addMessage("s1", note);

    const { container } = render(<ChatScreen onNavigate={() => {}} />);

    expect(container.querySelector(".lin-msg--user")).toBeNull();
    expect(container.querySelector(".lin-msg-system")?.textContent).toBe(
      'Background task · Background command "probe providers" completed (exit code 0)',
    );
    expect(container.textContent).not.toContain("<task-notification>");
  });
});

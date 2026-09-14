import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PendingPermission } from "../../stores/app-store";
import PermissionSheetA from "./PermissionSheetA";

const pending: PendingPermission = {
  requestId: "req-1",
  tool: {
    name: "Bash command",
    parameters: { text: "touch /tmp/canary2.txt", description: "Create empty canary2.txt file" },
  },
  options: [
    { id: "1", label: "Yes", keystroke: "1" },
    {
      id: "2",
      label: "Yes, and always allow access to cwd/ from this project",
      keystroke: "2",
    },
    { id: "3", label: "No", keystroke: "3" },
  ],
};

function swipe(el: Element, fromX: number, toX: number) {
  fireEvent.touchStart(el, { touches: [{ clientX: fromX }] });
  fireEvent.touchMove(el, { touches: [{ clientX: toX }] });
  fireEvent.touchEnd(el);
}

const question: PendingPermission = {
  requestId: "req-q",
  tool: { name: "A 或 B", parameters: { text: "這次要選 A 還是 B？" } },
  promptKind: "question",
  options: [
    { id: "1", label: "A" },
    { id: "2", label: "B" },
  ],
};

describe("PermissionSheetA — swipe gestures", () => {
  afterEach(() => cleanup());

  test("swipe right past threshold → onApprove", () => {
    let approved = 0;
    let denied = 0;
    const { container } = render(
      <PermissionSheetA pending={pending} onApprove={() => approved++} onDeny={() => denied++} />,
    );
    const sheet = container.querySelector(".lin-permission");
    expect(sheet).not.toBeNull();
    swipe(sheet as Element, 50, 150);
    expect(approved).toBe(1);
    expect(denied).toBe(0);
  });

  test("swipe left past threshold → onDeny", () => {
    let approved = 0;
    let denied = 0;
    const { container } = render(
      <PermissionSheetA pending={pending} onApprove={() => approved++} onDeny={() => denied++} />,
    );
    const sheet = container.querySelector(".lin-permission") as Element;
    swipe(sheet, 200, 100);
    expect(approved).toBe(0);
    expect(denied).toBe(1);
  });

  test("short drag below threshold → neither fires, transform resets", () => {
    let approved = 0;
    let denied = 0;
    const { container } = render(
      <PermissionSheetA pending={pending} onApprove={() => approved++} onDeny={() => denied++} />,
    );
    const sheet = container.querySelector(".lin-permission") as HTMLElement;
    swipe(sheet, 100, 140);
    expect(approved).toBe(0);
    expect(denied).toBe(0);
    expect(sheet.style.transform).toBe("");
  });

  test("dragging applies translateX feedback", () => {
    const { container } = render(
      <PermissionSheetA pending={pending} onApprove={() => {}} onDeny={() => {}} />,
    );
    const sheet = container.querySelector(".lin-permission") as HTMLElement;
    fireEvent.touchStart(sheet, { touches: [{ clientX: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientX: 160 }] });
    expect(sheet.style.transform).toBe("translateX(60px)");
    fireEvent.touchEnd(sheet);
  });
});

/**
 * PermissionSheetServerOptions — the sheet shows exactly the choices the
 * terminal is offering, in the terminal's own words. There is no fixed
 * approve/deny pair any more: a Bash prompt inside the project offers three
 * options, elsewhere two, and only the pane knows which.
 */
describe("PermissionSheetServerOptions", () => {
  afterEach(() => cleanup());

  function buttons(container: HTMLElement): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll(".lin-permission-actions button"),
    ) as HTMLButtonElement[];
  }

  test("renders one button per server option, labelled verbatim", () => {
    const { container } = render(
      <PermissionSheetA pending={pending} onApprove={() => {}} onDeny={() => {}} />,
    );

    expect(buttons(container).map((b) => b.textContent)).toEqual([
      "Yes",
      "Yes, and always allow access to cwd/ from this project",
      "No",
    ]);
  });

  test("shows the parsed screen text and description, not a tool argument shape", () => {
    const { container } = render(
      <PermissionSheetA pending={pending} onApprove={() => {}} onDeny={() => {}} />,
    );

    expect(container.querySelector(".lin-permission-target")?.textContent).toBe(
      "touch /tmp/canary2.txt",
    );
    expect(container.querySelector(".lin-permission-description")?.textContent).toBe(
      "Create empty canary2.txt file",
    );
  });

  test("tapping an option answers with that option's id", () => {
    const chosen: string[] = [];
    const { container } = render(
      <PermissionSheetA
        pending={pending}
        onApprove={() => {}}
        onDeny={() => {}}
        onChoose={(id) => chosen.push(id)}
      />,
    );

    fireEvent.click(buttons(container)[2]);

    expect(chosen).toEqual(["3"]);
  });

  test("after a tap the remaining options are disabled", () => {
    const { container } = render(
      <PermissionSheetA
        pending={pending}
        onApprove={() => {}}
        onDeny={() => {}}
        onChoose={() => {}}
      />,
    );

    fireEvent.click(buttons(container)[0]);

    expect(buttons(container).every((b) => b.disabled)).toBe(true);
  });

  test("a second tap sends nothing more", () => {
    const chosen: string[] = [];
    const { container } = render(
      <PermissionSheetA
        pending={pending}
        onApprove={() => {}}
        onDeny={() => {}}
        onChoose={(id) => chosen.push(id)}
      />,
    );

    fireEvent.click(buttons(container)[0]);
    fireEvent.click(buttons(container)[2]);

    expect(chosen).toEqual(["1"]);
  });

  test("an unparseable prompt renders the raw text with a single Cancel", () => {
    const raw: PendingPermission = {
      requestId: "req-2",
      tool: { name: "Permission required", parameters: { text: "raw screen" } },
      options: [],
    };
    const chosen: string[] = [];
    const { container } = render(
      <PermissionSheetA
        pending={raw}
        onApprove={() => {}}
        onDeny={() => {}}
        onChoose={(id) => chosen.push(id)}
      />,
    );

    expect(container.querySelector(".lin-permission-target")?.textContent).toBe("raw screen");
    const actions = buttons(container);
    expect(actions.map((b) => b.textContent)).toEqual(["Cancel"]);

    fireEvent.click(actions[0]);
    expect(chosen).toEqual(["cancel"]);
  });
});

/**
 * QuestionCardPresentation — the same sheet, worn as a question. The 60s
 * counter and the swipe hint are both claims about a permission prompt; on a
 * question they would describe a deadline and a gesture that do not exist.
 */
describe("QuestionCardPresentation", () => {
  afterEach(() => cleanup());

  function buttons(container: HTMLElement): HTMLButtonElement[] {
    return Array.from(
      container.querySelectorAll(".lin-permission-actions button"),
    ) as HTMLButtonElement[];
  }

  test("T1: a question is labelled a question, with no timer and no swipe hint", () => {
    const { container } = render(
      <PermissionSheetA pending={question} onApprove={() => {}} onDeny={() => {}} />,
    );

    expect(container.querySelector(".lin-permission-label")?.textContent).toBe("Question");
    expect(container.querySelector(".lin-permission-timer")).toBeNull();
    expect(container.querySelector(".lin-permission-hint")).toBeNull();
    expect(buttons(container).map((b) => b.textContent)).toEqual(["A", "B"]);
  });

  test("T2: tapping an answer sends its id and locks the card", () => {
    const chosen: string[] = [];
    const { container } = render(
      <PermissionSheetA
        pending={question}
        onApprove={() => {}}
        onDeny={() => {}}
        onChoose={(id) => chosen.push(id)}
      />,
    );

    fireEvent.click(buttons(container)[1]);

    expect(chosen).toEqual(["2"]);
    expect(buttons(container).every((b) => b.disabled)).toBe(true);
  });

  test("T3: a permission card is untouched — label, timer and hint all stand", () => {
    const { container } = render(
      <PermissionSheetA pending={pending} onApprove={() => {}} onDeny={() => {}} />,
    );

    expect(container.querySelector(".lin-permission-label")?.textContent).toBe(
      "Permission Required",
    );
    expect(container.querySelector(".lin-permission-timer")).not.toBeNull();
    expect(container.querySelector(".lin-permission-hint")).not.toBeNull();
  });

  test("T4: a question with no readable options still offers a way out", () => {
    const { container } = render(
      <PermissionSheetA
        pending={{ ...question, options: [] }}
        onApprove={() => {}}
        onDeny={() => {}}
        onChoose={() => {}}
      />,
    );

    expect(buttons(container).map((b) => b.textContent)).toEqual(["Cancel"]);
  });
});

/**
 * QuestionCardIgnoresSwipe — approve and deny are permission verbs. On a
 * question a right swipe used to send the first option, answering for the
 * user; the gesture is inert there, down to the drag feedback.
 */
describe("QuestionCardIgnoresSwipe", () => {
  afterEach(() => cleanup());

  function sheetOf(pendingCard: PendingPermission, counts: { approved: number; denied: number }) {
    const { container } = render(
      <PermissionSheetA
        pending={pendingCard}
        onApprove={() => counts.approved++}
        onDeny={() => counts.denied++}
      />,
    );
    return container.querySelector(".lin-permission") as HTMLElement;
  }

  test("T1: swiping right on a question approves nothing", () => {
    const counts = { approved: 0, denied: 0 };
    swipe(sheetOf(question, counts), 50, 150);
    expect(counts.approved).toBe(0);
  });

  test("T2: swiping left on a question denies nothing", () => {
    const counts = { approved: 0, denied: 0 };
    swipe(sheetOf(question, counts), 200, 100);
    expect(counts.denied).toBe(0);
  });

  test("T3: dragging a question promises no movement", () => {
    const counts = { approved: 0, denied: 0 };
    const sheet = sheetOf(question, counts);
    fireEvent.touchStart(sheet, { touches: [{ clientX: 100 }] });
    fireEvent.touchMove(sheet, { touches: [{ clientX: 160 }] });
    expect(sheet.style.transform).toBe("");
    fireEvent.touchEnd(sheet);
  });

  test("T4: a permission card still approves on a right swipe", () => {
    const counts = { approved: 0, denied: 0 };
    swipe(sheetOf(pending, counts), 50, 150);
    expect(counts.approved).toBe(1);
  });
});

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

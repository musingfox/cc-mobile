import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PendingPermission } from "../../stores/app-store";
import PermissionSheetA from "./PermissionSheetA";

const pending: PendingPermission = {
  requestId: "req-1",
  tool: { name: "Bash", parameters: { command: "ls -la" } },
} as PendingPermission;

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

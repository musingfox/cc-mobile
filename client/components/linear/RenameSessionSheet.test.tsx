import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { toastService } from "../../services/toast-service";
import { wsService } from "../../services/ws-service";
import RenameSessionSheet from "./RenameSessionSheet";

describe("RenameSessionSheet", () => {
  const originalSetSessionTitle = wsService.setSessionTitle;
  const originalListSessions = wsService.listSessions;
  const originalToastSuccess = toastService.success;

  beforeEach(() => {
    wsService.setSessionTitle = mock(() => {}) as typeof wsService.setSessionTitle;
    wsService.listSessions = mock(() => {}) as typeof wsService.listSessions;
    toastService.success = mock(() => "") as unknown as typeof toastService.success;
  });

  afterEach(() => {
    wsService.setSessionTitle = originalSetSessionTitle;
    wsService.listSessions = originalListSessions;
    toastService.success = originalToastSuccess;
    cleanup();
  });

  test("input is pre-populated with initial title", () => {
    const { getByLabelText } = render(
      <RenameSessionSheet
        open
        onClose={() => {}}
        sdkSessionId="u-1"
        cwd="/p"
        initialTitle="My Title"
      />,
    );
    const input = getByLabelText("Session title") as HTMLInputElement;
    expect(input.value).toBe("My Title");
  });

  test("Save button is disabled when title is unchanged", () => {
    const { getByText } = render(
      <RenameSessionSheet
        open
        onClose={() => {}}
        sdkSessionId="u-1"
        cwd="/p"
        initialTitle="Same"
      />,
    );
    const btn = getByText("Save").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test("Save button is disabled when input is empty", () => {
    const { getByLabelText, getByText } = render(
      <RenameSessionSheet
        open
        onClose={() => {}}
        sdkSessionId="u-1"
        cwd="/p"
        initialTitle="Was"
      />,
    );
    fireEvent.change(getByLabelText("Session title"), { target: { value: "   " } });
    const btn = getByText("Save").closest("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  test("Save dispatches rename + refresh + toast and closes the sheet", async () => {
    const onClose = mock(() => {});
    const { getByLabelText, getByText } = render(
      <RenameSessionSheet
        open
        onClose={onClose}
        sdkSessionId="u-1"
        cwd="/p"
        initialTitle="Old"
      />,
    );
    fireEvent.change(getByLabelText("Session title"), { target: { value: "  New title  " } });
    fireEvent.click(getByText("Save"));

    // Allow the microtasks in handleSave to settle.
    await Promise.resolve();
    await Promise.resolve();

    expect(wsService.setSessionTitle).toHaveBeenCalledTimes(1);
    expect(
      (wsService.setSessionTitle as unknown as { mock: { calls: unknown[][] } }).mock.calls[0],
    ).toEqual(["u-1", "New title", "/p"]);
    expect(wsService.listSessions).toHaveBeenCalledTimes(1);
    expect(
      (wsService.listSessions as unknown as { mock: { calls: unknown[][] } }).mock.calls[0],
    ).toEqual(["/p"]);
    expect(toastService.success).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

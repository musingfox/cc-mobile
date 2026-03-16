import { describe, expect, it, mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import type { PendingPermission } from "../stores/app-store";
import PermissionBar from "./PermissionBar";

describe("PermissionBar", () => {
  it("8. renders PermissionFooter with tool info", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: {
        name: "Edit",
        parameters: { file_path: "test.ts" },
      },
    };

    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { container } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    // Should render PermissionFooter
    const footer = container.querySelector(".permission-footer");
    expect(footer).not.toBeNull();

    // Should have 3 options
    const options = container.querySelectorAll(".permission-option");
    expect(options).toHaveLength(3);
  });

  it("9. Approve action calls onApprove handler", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: {
        name: "Edit",
        parameters: { file_path: "test.ts" },
      },
    };

    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { container } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[0]); // First option is "Yes"

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("Deny action calls onDeny handler", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: {
        name: "Edit",
        parameters: { file_path: "test.ts" },
      },
    };

    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { container } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[2]); // Third option is "No"

    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("approve_session action calls onApprove (deferred behavior)", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: {
        name: "Edit",
        parameters: { file_path: "test.ts" },
      },
    };

    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { container } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    fireEvent.click(buttons[1]); // Second option is "Yes, allow all edits"

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("returns null when pending is null", () => {
    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { container } = render(
      <PermissionBar pending={null} onApprove={onApprove} onDeny={onDeny} />,
    );

    expect(container.querySelector(".permission-bar")).toBeNull();
  });

  it("renders Bash tool with command", () => {
    const pending: PendingPermission = {
      requestId: "req-2",
      tool: {
        name: "Bash",
        parameters: { command: "ls -la" },
      },
    };

    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { container } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    const buttons = container.querySelectorAll(".permission-option");
    expect(buttons[1].textContent).toContain("Yes, allow `ls -la` for session");
  });
});

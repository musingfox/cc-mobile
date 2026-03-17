import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PendingPermission } from "../stores/app-store";
import PermissionBar from "./PermissionBar";

describe("PermissionBar", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders PermissionFooter with tool info and 3 buttons", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: {
        name: "Edit",
        parameters: { file_path: "test.ts" },
      },
    };

    const { container, getByText } = render(
      <PermissionBar pending={pending} onApprove={mock(() => {})} onDeny={mock(() => {})} />,
    );

    expect(container.querySelector(".permission-footer")).not.toBeNull();
    expect(getByText("Edit")).not.toBeNull();
    expect(container.querySelectorAll(".permission-btn")).toHaveLength(3);
  });

  it("approve action calls onApprove handler", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: { name: "Edit", parameters: { file_path: "test.ts" } },
    };
    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { getByText } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    fireEvent.click(getByText("Yes"));
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onDeny).not.toHaveBeenCalled();
  });

  it("deny action calls onDeny handler", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: { name: "Edit", parameters: { file_path: "test.ts" } },
    };
    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { getByText } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    fireEvent.click(getByText("No"));
    expect(onDeny).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("approve_session calls onApprove (deferred)", () => {
    const pending: PendingPermission = {
      requestId: "req-1",
      tool: { name: "Edit", parameters: { file_path: "test.ts" } },
    };
    const onApprove = mock(() => {});
    const onDeny = mock(() => {});

    const { getByText } = render(
      <PermissionBar pending={pending} onApprove={onApprove} onDeny={onDeny} />,
    );

    fireEvent.click(getByText("Allow in this session"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("returns null when pending is null", () => {
    const { container } = render(
      <PermissionBar pending={null} onApprove={mock(() => {})} onDeny={mock(() => {})} />,
    );
    expect(container.querySelector(".permission-bar")).toBeNull();
  });

  it("renders Bash tool with command param", () => {
    const pending: PendingPermission = {
      requestId: "req-2",
      tool: { name: "Bash", parameters: { command: "ls -la" } },
    };

    const { getByText } = render(
      <PermissionBar pending={pending} onApprove={mock(() => {})} onDeny={mock(() => {})} />,
    );

    expect(getByText("Bash")).not.toBeNull();
    expect(getByText("ls -la")).not.toBeNull();
  });
});

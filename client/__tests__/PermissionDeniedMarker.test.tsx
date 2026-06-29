import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import PermissionDeniedMarker from "../components/linear/PermissionDeniedMarker";

describe("PermissionDeniedMarker", () => {
  afterEach(() => cleanup());

  test("renders tool name and message text", () => {
    const { getByText, container } = render(
      <PermissionDeniedMarker toolName="Bash" message="Bash is not allowed" />,
    );
    expect(getByText("Permission denied: Bash")).toBeTruthy();
    expect(getByText("Bash is not allowed")).toBeTruthy();
    // Class is lin-deny-marker — distinct from any tool-error class
    expect(container.querySelector(".lin-deny-marker")).not.toBeNull();
  });

  test("uses a marker class distinct from tool-error styling", () => {
    const { container } = render(
      <PermissionDeniedMarker toolName="Read" message="denied" />,
    );
    const root = container.querySelector(".lin-deny-marker");
    expect(root).not.toBeNull();
    // No tool-error variants should be present
    expect(root?.classList.contains("lin-tool-error")).toBe(false);
    expect(root?.classList.contains("lin-msg--error")).toBe(false);
    expect(root?.classList.contains("is-error")).toBe(false);
  });
});

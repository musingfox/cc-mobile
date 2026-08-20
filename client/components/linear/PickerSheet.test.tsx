import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import PickerSheet from "./PickerSheet";

describe("PickerSheetTerminates", () => {
  afterEach(() => {
    cleanup();
  });

  test("T1: loading shows Loading…", () => {
    const { getByText, queryByText } = render(
      <PickerSheet kind="slash" items={[]} open onClose={() => {}} onSelect={() => {}} loading />,
    );
    expect(getByText("Loading…")).not.toBeNull();
    expect(queryByText("No commands available.")).toBeNull();
  });

  test("T7: a command with no description has no desc element", () => {
    const { getByText, container } = render(
      <PickerSheet
        kind="slash"
        items={[{ name: "bare" }]}
        open
        onClose={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(getByText("bare")).not.toBeNull();
    expect(container.querySelector(".lin-settings-row-desc")).toBeNull();
  });
});

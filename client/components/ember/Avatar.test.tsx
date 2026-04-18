import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import Avatar from "./Avatar";

describe("Avatar", () => {
  test("renders first character uppercase from label", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Builder" />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    expect(avatar).toBeDefined();
    expect(avatar.textContent).toBe("B");
  });

  test("renders two characters from multi-word label", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Claude Code" />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    expect(avatar.textContent).toBe("CC");
  });

  test("square shape applies square class", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Agent" shape="square" />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    expect(avatar.className).toContain("ember-avatar--square");
    expect(avatar.className).not.toContain("ember-avatar--circle");
  });

  test("neutral variant applies different background and border", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Test" variant="neutral" />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    expect(avatar.className).toContain("ember-avatar--neutral");
  });

  test("gradient variant is default", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Test" />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    expect(avatar.className).toContain("ember-avatar--gradient");
  });

  test("size prop sets width and height", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Test" size={40} />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    const style = avatar.getAttribute("style");
    expect(style).toContain("width: 40px");
    expect(style).toContain("height: 40px");
  });

  test("avatar has aria-hidden true", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Test" />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
  });

  test("circle shape is default", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Test" />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    expect(avatar.className).toContain("ember-avatar--circle");
  });

  test("font size is proportional to avatar size", () => {
    const { container } = render(
      <div className="theme-ember">
        <Avatar label="Test" size={40} />
      </div>,
    );

    const avatar = container.querySelector(".ember-avatar") as HTMLElement;
    const style = avatar.getAttribute("style");
    // fontSize = size / 2 - 4 = 40 / 2 - 4 = 16
    expect(style).toContain("font-size: 16px");
  });
});

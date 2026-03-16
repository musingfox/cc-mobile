import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { UsageData } from "../stores/app-store";
import InputStatus from "./InputStatus";

describe("InputStatus", () => {
  afterEach(() => {
    cleanup();
  });
  test("renders cost, tokens, turns when connected with usage data", () => {
    const usage: UsageData = {
      totalCost: 0.05,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 2,
      durationMs: 5000,
    };

    const { container } = render(<InputStatus connected={true} usage={usage} />);

    const text = container.textContent;
    expect(text).toContain("$0.05");
    expect(text).toContain("1.5k tokens");
    expect(text).toContain("2 turns");

    const dot = container.querySelector(".input-status-dot");
    expect(dot?.classList.contains("connected")).toBe(true);
  });

  test("renders Disconnected with red dot when not connected", () => {
    const { container } = render(<InputStatus connected={false} usage={null} />);

    expect(container.textContent).toContain("Disconnected");

    const dot = container.querySelector(".input-status-dot");
    expect(dot?.classList.contains("disconnected")).toBe(true);
  });

  test("formats tokens correctly - 1500 to 1.5k", () => {
    const usage: UsageData = {
      totalCost: 0.01,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 1,
      durationMs: 1000,
    };

    const { container } = render(<InputStatus connected={true} usage={usage} />);

    expect(container.textContent).toContain("1.5k tokens");
  });

  test("formats tokens correctly - 2000000 to 2.0M", () => {
    const usage: UsageData = {
      totalCost: 5.0,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      turns: 10,
      durationMs: 60000,
    };

    const { container } = render(<InputStatus connected={true} usage={usage} />);

    expect(container.textContent).toContain("2.0M tokens");
  });

  test("renders Connected when connected but no usage yet", () => {
    const { container } = render(<InputStatus connected={true} usage={null} />);

    expect(container.textContent).toContain("Connected");

    const dot = container.querySelector(".input-status-dot");
    expect(dot?.classList.contains("connected")).toBe(true);
  });
});

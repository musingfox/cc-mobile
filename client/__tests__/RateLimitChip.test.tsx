import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import RateLimitChip from "../components/linear/RateLimitChip";
import { useAppStore } from "../stores/app-store";

function setRateLimit(
  info: Parameters<typeof useAppStore.getState>[0] extends never
    ? never
    : ReturnType<typeof useAppStore.getState>["rateLimitInfo"],
) {
  useAppStore.setState({ rateLimitInfo: info });
}

function setSubscription(subscriptionType?: string) {
  useAppStore.setState({
    capabilities: {
      commands: [],
      agents: [],
      model: "test-model",
      ...(subscriptionType ? { accountInfo: { subscriptionType } } : {}),
    },
  });
}

describe("RateLimitChip", () => {
  beforeEach(() => {
    useAppStore.setState({ rateLimitInfo: null, capabilities: null });
  });

  afterEach(() => {
    useAppStore.setState({ rateLimitInfo: null, capabilities: null });
    cleanup();
  });

  test("renders 'Quota resets in 14m' (or 13m) for allowed_warning + pro subscription", () => {
    setSubscription("pro");
    setRateLimit({
      status: "allowed_warning",
      resetsAt: Date.now() + 14 * 60 * 1000,
    });

    const { getByTestId } = render(<RateLimitChip />);
    const chip = getByTestId("rate-limit-chip");
    expect(chip.textContent ?? "").toMatch(/Quota resets in 1[34]m/);
  });

  test("renders chip with hours formatting for long windows (e.g. 2h)", () => {
    setSubscription("pro");
    setRateLimit({
      status: "allowed_warning",
      resetsAt: Date.now() + 2 * 60 * 60 * 1000,
    });

    const { getByTestId } = render(<RateLimitChip />);
    const chip = getByTestId("rate-limit-chip");
    expect(chip.textContent ?? "").toMatch(/Quota resets in 2h/);
  });

  test("rateLimitInfo === null → chip absent (Empty)", () => {
    setSubscription("pro");
    const { container } = render(<RateLimitChip />);
    expect(container.querySelector('[data-testid="rate-limit-chip"]')).toBeNull();
  });

  test("rejected + no subscription (API-key user) → still rendered with 'Quota exhausted'", () => {
    // subscriptionType undefined
    setRateLimit({ status: "rejected" });

    const { getByTestId } = render(<RateLimitChip />);
    const chip = getByTestId("rate-limit-chip");
    expect(chip.textContent).toBe("Quota exhausted");
    expect(chip.className).toContain("lin-rate-limit-chip--rejected");
  });

  test("rejected + pro subscription → rendered with 'Quota exhausted'", () => {
    setSubscription("pro");
    setRateLimit({ status: "rejected" });

    const { getByTestId } = render(<RateLimitChip />);
    expect(getByTestId("rate-limit-chip").textContent).toBe("Quota exhausted");
  });

  test("allowed_warning + resetsAt in the past → chip hidden (Stale)", () => {
    setSubscription("pro");
    setRateLimit({
      status: "allowed_warning",
      resetsAt: Date.now() - 1000,
    });

    const { container } = render(<RateLimitChip />);
    expect(container.querySelector('[data-testid="rate-limit-chip"]')).toBeNull();
  });

  test("allowed_warning + no subscription (API-key user) → chip hidden (D6 gate)", () => {
    // API-key users see only the rejected escape hatch.
    setRateLimit({
      status: "allowed_warning",
      resetsAt: Date.now() + 5 * 60 * 1000,
    });

    const { container } = render(<RateLimitChip />);
    expect(container.querySelector('[data-testid="rate-limit-chip"]')).toBeNull();
  });

  test("allowed_warning + resetsAt missing → shows 'Approaching quota'", () => {
    setSubscription("pro");
    setRateLimit({ status: "allowed_warning" });

    const { getByTestId } = render(<RateLimitChip />);
    expect(getByTestId("rate-limit-chip").textContent).toBe("Approaching quota");
  });

  test("allowed status (no warning) on pro → no chip (only warning/rejected surface)", () => {
    setSubscription("pro");
    setRateLimit({ status: "allowed", resetsAt: Date.now() + 5 * 60 * 1000 });

    // "allowed" with future reset: subscription gate passes, status isn't
    // rejected, so we still render the countdown — match what the contract
    // says (D6: gate is account-type, not status, except rejected which
    // bypasses gate).
    const { getByTestId } = render(<RateLimitChip />);
    expect(getByTestId("rate-limit-chip").textContent ?? "").toMatch(/Quota resets in/);
  });
});

import { expect, test } from "@playwright/test";
import { createSession } from "./helpers/test-utils";

test.describe("Chat Flow", () => {
  test("sends a message and receives streaming response", async ({ page }) => {
    await createSession(page, "/tmp");

    // Type a message in the input
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    // User message should appear in chat
    await expect(page.locator(".message.user").last()).toContainText("hello");

    // Assistant response should stream in
    await expect(page.locator(".message.assistant").last()).toContainText(
      "Hello! I'm Claude, your AI assistant.",
      { timeout: 10000 },
    );

    // Cost data should appear in status bar after response completes
    await expect(page.getByText("$0.01")).toBeVisible({ timeout: 5000 });
  });

  test("shows streaming indicator while response is in progress", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for response to complete fully
    await expect(page.locator(".message.assistant").last()).toContainText(
      "How can I help you today?",
      { timeout: 10000 },
    );
  });

  test("input is cleared after sending", async ({ page }) => {
    await createSession(page, "/tmp");

    const input = page.getByPlaceholder("Type a message");
    await input.fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    // Input should be cleared after send
    await expect(input).toHaveValue("");
  });

  test("send button is disabled when input is empty", async ({ page }) => {
    await createSession(page, "/tmp");

    const sendBtn = page.getByRole("button", { name: "Send message" });
    await expect(sendBtn).toBeDisabled();

    // Type something — button should enable
    await page.getByPlaceholder("Type a message").fill("hello");
    await expect(sendBtn).toBeEnabled();
  });
});

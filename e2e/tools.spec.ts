import { expect, test } from "@playwright/test";
import { createSession } from "./helpers/test-utils";

test.describe("Tool Display", () => {
  test("shows tool card after tool execution", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("use a tool");
    await page.getByRole("button", { name: "Send message" }).click();

    // Tool card should appear with tool name (Bash)
    await expect(page.getByText("Bash")).toBeVisible({ timeout: 10000 });

    // Response text should appear
    await expect(page.getByText("Here are the files in your directory.")).toBeVisible({
      timeout: 10000,
    });
  });

  test("tool card shows summary when clicked", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("use a tool");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for tool card to appear (as collapsed chip)
    const toolChip = page.locator(".tool-chip");
    await expect(toolChip).toBeVisible({ timeout: 10000 });

    // Click tool chip to expand
    await toolChip.click();

    // Verify expanded card is visible with summary
    await expect(page.locator(".tool-card")).toBeVisible({ timeout: 5000 });

    // Verify summary text visible (from fixture: "Ran: ls /Users/test/playground (3 files listed)")
    await expect(page.getByText(/Ran:.*ls \/Users\/test\/playground/)).toBeVisible({
      timeout: 5000,
    });
  });

  test("multiple messages show correct order", async ({ page }) => {
    await createSession(page, "/tmp");

    // Send first message
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for first response
    await expect(page.locator(".message.assistant").last()).toContainText(
      "Hello! I'm Claude, your AI assistant.",
      { timeout: 10000 },
    );

    // Send second message
    await page.getByPlaceholder("Type a message").fill("use a tool");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for tool response
    await expect(page.getByText("Here are the files in your directory.")).toBeVisible({
      timeout: 10000,
    });

    // Verify message order: 2 user messages, 2 assistant messages
    const userMessages = page.locator(".message.user");
    const assistantMessages = page.locator(".message.assistant");

    await expect(userMessages).toHaveCount(2);
    await expect(assistantMessages).toHaveCount(2);

    // Verify first user message
    await expect(userMessages.nth(0)).toContainText("hello");
    // Verify second user message
    await expect(userMessages.nth(1)).toContainText("use a tool");
  });
});

import { expect, test } from "@playwright/test";
import { createSession } from "./helpers/test-utils";

test.describe("Session Creation", () => {
  test("creates a session and shows connected state", async ({ page }) => {
    await createSession(page, "/tmp");
  });
});

test.describe("Tool Status Display", () => {
  test("shows tool card and response after tool execution", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("use a tool to list files");
    await page.getByRole("button", { name: "Send message" }).click();

    // Tool card should appear (collapsed) with tool name
    await expect(page.getByText("Bash")).toBeVisible({ timeout: 10000 });

    // Response text should appear
    await expect(page.getByText("Here are the files in your directory.")).toBeVisible({
      timeout: 10000,
    });

    // Tool card should be expandable — click to reveal summary
    await page.getByText("Bash").click();
    await expect(page.getByText("ls /Users/test/playground")).toBeVisible({ timeout: 5000 });

    // ActivityPanel should be cleared after stream ends
    await expect(page.locator(".activity-tool")).not.toBeVisible({ timeout: 5000 });
  });
});

test.describe("Cost StatusBar", () => {
  test("shows cost and token usage after response completes", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("use a tool");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for response to complete
    await expect(page.getByText("Here are the files in your directory.")).toBeVisible({
      timeout: 10000,
    });

    // StatusBar should show cost data from fixture (fixture has $0.0342 → rounds to $0.03)
    await expect(page.getByText("$0.03")).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Agent Status Display", () => {
  test("shows response and cost from agent execution", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("use an agent to search");
    await page.getByRole("button", { name: "Send message" }).click();

    // Response should appear after agent completes
    await expect(page.getByText("I found 12 config files")).toBeVisible({ timeout: 10000 });

    // StatusBar should show agent fixture cost
    await expect(page.getByText("$0.08")).toBeVisible({ timeout: 5000 });
  });
});

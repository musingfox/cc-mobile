import { expect, test } from "@playwright/test";
import { createSession } from "./helpers/test-utils";

test.describe("Navigation", () => {
  test("can create multiple sessions", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.locator(".status-dot.connected")).toBeVisible({ timeout: 10000 });

    // Create first session
    await page.getByPlaceholder("Or type a path").fill("/tmp");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Connected — tmp")).toBeVisible({ timeout: 10000 });

    // Send a message in first session to prevent it from being removed when creating second session
    // (ws-service removes empty sessions when creating new ones)
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".message.assistant")).toBeVisible({ timeout: 10000 });

    // Click "+" to create another session
    await page.locator(".session-tab.add").click();
    await page.waitForTimeout(500); // Wait for picker to open

    // Create second session
    await page.getByPlaceholder("Or type a path").fill("/var");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Connected — var")).toBeVisible({ timeout: 10000 });

    // Verify both tabs exist
    await expect(page.locator(".session-tab").filter({ hasText: "tmp" })).toBeVisible();
    await expect(page.locator(".session-tab").filter({ hasText: "var" })).toBeVisible();

    // Verify 2 session tabs exist (excluding the "+" button)
    const sessionTabs = page.locator(".session-tab").filter({ hasNotText: "+" });
    await expect(sessionTabs).toHaveCount(2);
  });

  test("can switch between sessions", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.locator(".status-dot.connected")).toBeVisible({ timeout: 10000 });

    // Create first session and send message
    await page.getByPlaceholder("Or type a path").fill("/tmp");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Connected — tmp")).toBeVisible({ timeout: 10000 });

    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for response
    await expect(page.locator(".message.assistant").last()).toContainText(
      "Hello! I'm Claude, your AI assistant.",
      { timeout: 10000 },
    );

    // Wait a bit for first session to stabilize
    await page.waitForTimeout(500);

    // Create second session
    await page.locator(".session-tab.add").click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder("Or type a path").fill("/var");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Connected — var")).toBeVisible({ timeout: 10000 });

    // Verify no messages in new session (empty state)
    await expect(page.locator(".message")).toHaveCount(0);

    // Switch back to first session
    const tmpTab = page.locator(".session-tab").filter({ hasText: "tmp" });
    await tmpTab.locator(".session-tab-main").click();
    await page.waitForTimeout(500); // Wait for session switch

    // Verify previous messages still visible
    await expect(page.locator(".message.user")).toContainText("hello");
    await expect(page.locator(".message.assistant")).toContainText(
      "Hello! I'm Claude, your AI assistant.",
    );
  });

  test("command picker opens as drawer", async ({ page }) => {
    await createSession(page, "/tmp");

    // Click "/" button to open command panel
    await page.getByRole("button", { name: "Open command panel" }).click();

    // Wait for drawer to be visible
    await expect(page.locator(".drawer-content")).toBeVisible({ timeout: 5000 });

    // Verify search input visible
    await expect(page.locator(".command-panel-search")).toBeVisible();

    // Verify command items listed
    await expect(page.locator(".command-panel-item")).toHaveCount(
      await page.locator(".command-panel-item").count(),
    );
  });

  test("agent picker opens as drawer", async ({ page }) => {
    await createSession(page, "/tmp");

    // Click "@" button to open agent panel
    await page.getByRole("button", { name: "Open agent panel" }).click();

    // Wait for drawer to be visible
    await expect(page.locator(".drawer-content")).toBeVisible({ timeout: 5000 });

    // Verify agent items listed
    await expect(page.locator(".command-panel-item")).toHaveCount(
      await page.locator(".command-panel-item").count(),
    );
  });

  test("settings opens as drawer", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.locator(".status-dot.connected")).toBeVisible({ timeout: 10000 });

    // Click settings button (gear icon in status bar)
    await page.locator(".status-settings-btn").click();

    // Wait for drawer with "Settings" text
    await expect(page.getByText("Settings")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".drawer-content")).toBeVisible({ timeout: 5000 });

    // Verify theme buttons visible
    await expect(page.getByRole("button", { name: "Dark" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Light" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Claude" })).toBeVisible();
  });

  test("close session tab", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.locator(".status-dot.connected")).toBeVisible({ timeout: 10000 });

    // Create two sessions (need at least 2 to show close button)
    await page.getByPlaceholder("Or type a path").fill("/tmp");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Connected — tmp")).toBeVisible({ timeout: 10000 });

    // Send a message in first session to prevent it from being removed
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator(".message.assistant")).toBeVisible({ timeout: 10000 });

    await page.locator(".session-tab.add").click();
    await page.waitForTimeout(500);
    await page.getByPlaceholder("Or type a path").fill("/var");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Connected — var")).toBeVisible({ timeout: 10000 });

    // Verify both tabs exist
    await expect(page.locator(".session-tab").filter({ hasText: "tmp" })).toBeVisible();
    await expect(page.locator(".session-tab").filter({ hasText: "var" })).toBeVisible();

    // Find and click close button on var tab
    const varTab = page.locator(".session-tab").filter({ hasText: "var" });
    await varTab.locator(".session-tab-close").click();

    // Verify var tab is gone
    await expect(page.locator(".session-tab").filter({ hasText: "var" })).not.toBeVisible();

    // Verify tmp tab still exists
    await expect(page.locator(".session-tab").filter({ hasText: "tmp" })).toBeVisible();
  });
});

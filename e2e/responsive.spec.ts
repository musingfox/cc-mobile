import { expect, test } from "@playwright/test";
import { createSession } from "./helpers/test-utils";

test.describe("Responsive", () => {
  test.use({ viewport: { width: 375, height: 812 } }); // iPhone viewport

  test("renders correctly on mobile viewport", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.locator(".status-dot.connected")).toBeVisible({ timeout: 10000 });

    // Verify status bar visible
    await expect(page.locator(".status-bar")).toBeVisible();

    // Verify input bar visible
    await expect(page.locator(".input-bar")).toBeVisible();

    // Verify no horizontal scroll (page width <= viewport width)
    const pageWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = page.viewportSize()?.width ?? 0;
    expect(pageWidth).toBeLessThanOrEqual(viewportWidth);
  });

  test("can send message on mobile", async ({ page }) => {
    await createSession(page, "/tmp");

    // Fill and send message
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    // Verify response appears
    await expect(page.locator(".message.assistant").last()).toContainText(
      "Hello! I'm Claude, your AI assistant.",
      { timeout: 10000 },
    );
  });

  test("settings drawer works on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(2000);
    await expect(page.locator(".status-dot.connected")).toBeVisible({ timeout: 10000 });

    // Click settings button
    await page.locator(".status-settings-btn").click();

    // Verify drawer visible
    await expect(page.locator(".drawer-content")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Settings")).toBeVisible();

    // Verify theme buttons not clipped
    const darkBtn = page.getByRole("button", { name: "Dark" });
    const lightBtn = page.getByRole("button", { name: "Light" });
    const claudeBtn = page.getByRole("button", { name: "Claude" });

    await expect(darkBtn).toBeVisible();
    await expect(lightBtn).toBeVisible();
    await expect(claudeBtn).toBeVisible();

    // Verify buttons are within viewport
    const darkBox = await darkBtn.boundingBox();
    const lightBox = await lightBtn.boundingBox();
    const claudeBox = await claudeBtn.boundingBox();

    const viewportWidth = page.viewportSize()?.width ?? 0;

    expect(darkBox?.x).toBeGreaterThanOrEqual(0);
    expect(lightBox?.x).toBeGreaterThanOrEqual(0);
    expect(claudeBox?.x).toBeGreaterThanOrEqual(0);
    expect(darkBox ? darkBox.x + darkBox.width : 0).toBeLessThanOrEqual(viewportWidth);
    expect(lightBox ? lightBox.x + lightBox.width : 0).toBeLessThanOrEqual(viewportWidth);
    expect(claudeBox ? claudeBox.x + claudeBox.width : 0).toBeLessThanOrEqual(viewportWidth);
  });

  test("input bar stays at bottom on mobile", async ({ page }) => {
    await createSession(page, "/tmp");

    // Send a message
    await page.getByPlaceholder("Type a message").fill("hello");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for response
    await expect(page.locator(".message.assistant").last()).toContainText(
      "Hello! I'm Claude, your AI assistant.",
      { timeout: 10000 },
    );

    // Verify input bar is still visible at bottom
    await expect(page.locator(".input-bar-container")).toBeVisible();

    // Check that input bar is within viewport
    const inputBarBox = await page.locator(".input-bar-container").boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 0;

    expect(inputBarBox).not.toBeNull();
    expect(inputBarBox?.y).toBeGreaterThanOrEqual(0);
    expect(inputBarBox ? inputBarBox.y + inputBarBox.height : 0).toBeLessThanOrEqual(
      viewportHeight,
    );
  });
});

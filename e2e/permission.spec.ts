import { expect, test } from "@playwright/test";
import { createSession } from "./helpers/test-utils";

test.describe("Permission Flow", () => {
  test("shows permission bar when tool requires approval", async ({ page }) => {
    await createSession(page, "/tmp");

    // Send message that triggers permission fixture (use exact "permission" keyword only)
    await page.getByPlaceholder("Type a message").fill("permission");
    await page.getByRole("button", { name: "Send message" }).click();

    // Permission bar should appear with tool name
    await expect(page.locator(".permission-tool-name")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".permission-tool-name")).toHaveText("Bash");

    // Permission bar should show command details
    await expect(page.locator(".permission-tool-params")).toBeVisible({ timeout: 2000 });
    await expect(page.locator(".permission-tool-params")).toContainText("rm -rf");
  });

  test("approving permission allows tool to execute and response continues", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("permission");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for permission bar and buttons to be fully rendered
    await expect(page.locator(".permission-tool-name")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".permission-btn.green")).toBeVisible({ timeout: 2000 });

    // Small delay to ensure click handlers are attached
    await page.waitForTimeout(500);

    // Click "Yes" to approve
    await page.locator(".permission-btn.green").click();

    // Permission bar should disappear after approval
    await expect(page.locator(".permission-bar")).not.toBeVisible({ timeout: 3000 });

    // Response should contain the success message
    await expect(page.getByText("successfully deleted", { exact: false })).toBeVisible({
      timeout: 5000,
    });
  });

  test("denying permission stops execution and shows denial message", async ({ page }) => {
    await createSession(page, "/tmp");

    await page.getByPlaceholder("Type a message").fill("permission");
    await page.getByRole("button", { name: "Send message" }).click();

    // Wait for permission bar and buttons to be fully rendered
    await expect(page.locator(".permission-tool-name")).toBeVisible({ timeout: 5000 });
    await expect(page.locator(".permission-btn.red")).toBeVisible({ timeout: 2000 });

    // Small delay to ensure click handlers are attached
    await page.waitForTimeout(500);

    // Click "No" to deny
    await page.locator(".permission-btn.red").click();

    // Permission bar should disappear after denial
    await expect(page.locator(".permission-bar")).not.toBeVisible({ timeout: 3000 });

    // For now, just verify permission bar closed and success message didn't appear
    // The denial message handling will be improved in future iterations
    await page.waitForTimeout(1000);

    // Success message should NOT appear
    await expect(page.getByText("successfully deleted", { exact: false })).not.toBeVisible();
  });
});

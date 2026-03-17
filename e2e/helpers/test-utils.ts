import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function createSession(page: Page, cwd: string) {
  await page.goto("/");
  // Wait for WS to connect and stabilize
  await page.waitForTimeout(2000);
  await expect(page.locator(".status-dot.connected")).toBeVisible({ timeout: 10000 });

  await page.getByPlaceholder("Or type a path").fill(cwd);
  await page.getByRole("button", { name: "Create" }).click();

  // Status bar shows only the directory name (last path segment), not full path
  const dirName = cwd.split("/").pop() || cwd;
  await expect(page.getByText(`Connected — ${dirName}`)).toBeVisible({ timeout: 10000 });
}

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { swRegistrationManager } from "../services/sw-registration";

describe("SwRegistrationManager", () => {
  beforeEach(() => {
    // Reset registration state
    (swRegistrationManager as any).registration = null;
    delete (navigator as any).serviceWorker;
  });

  test("TC-SW1: registerServiceWorker in supported env returns registration", async () => {
    const mockRegistration = { scope: "/test-scope" } as ServiceWorkerRegistration;
    (navigator as any).serviceWorker = {
      register: mock(() => Promise.resolve(mockRegistration)),
    };

    const result = await swRegistrationManager.registerServiceWorker();
    expect(result).toBe(mockRegistration);
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith("/sw.js");
  });

  test("TC-SW2: registerServiceWorker when unsupported returns null", async () => {
    delete (navigator as any).serviceWorker;
    const result = await swRegistrationManager.registerServiceWorker();
    expect(result).toBeNull();
  });

  test("TC-SW3: getRegistration before register returns null", () => {
    const result = swRegistrationManager.getRegistration();
    expect(result).toBeNull();
  });

  test("TC-SW4: getRegistration after register returns registration", async () => {
    const mockRegistration = { scope: "/test-scope" } as ServiceWorkerRegistration;
    (navigator as any).serviceWorker = {
      register: mock(() => Promise.resolve(mockRegistration)),
    };

    await swRegistrationManager.registerServiceWorker();
    const result = swRegistrationManager.getRegistration();
    expect(result).toBe(mockRegistration);
  });
});

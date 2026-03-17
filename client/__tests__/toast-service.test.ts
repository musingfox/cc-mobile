import { describe, expect, test } from "bun:test";
import { toastService } from "../services/toast-service";

describe("toastService", () => {
  test("success is a function", () => {
    expect(typeof toastService.success).toBe("function");
  });

  test("error is a function", () => {
    expect(typeof toastService.error).toBe("function");
  });

  test("info is a function", () => {
    expect(typeof toastService.info).toBe("function");
  });
});

import { describe, expect, mock, test } from "bun:test";
import { runSend } from "./send-flow";

/**
 * Wiring gate for the testable async send path.
 *
 * Contract (frozen seam): `runSend` accepts the send inputs plus injected
 * collaborators so the orchestration can be asserted without DOM/store wiring:
 *
 *   runSend({
 *     sessionId, cwd, text,
 *     images: { base64, mediaType }[],   // not-yet-landed images
 *     fileAbsPaths: string[],            // already-landed file paths
 *     uploadImage: (sessionId, base64, mediaType) => Promise<{ path: string }>,
 *     ptySend: (sessionId, cwd, prompt) => void,
 *     clearInputs: () => void,
 *   }) => Promise<void>
 *
 * Behaviour only — never asserts whether claude actually reads the path.
 */

const baseArgs = () => ({
  sessionId: "s1",
  cwd: "/tmp/proj",
  text: "",
  images: [] as Array<{ base64: string; mediaType: string }>,
  fileAbsPaths: [] as string[],
});

describe("runSend wiring", () => {
  test("EX9: plain text -> ptySend exactly once verbatim, no frame, inputs cleared", async () => {
    const ptySend = mock(() => {});
    const uploadImage = mock(async () => ({ path: "/never" }));
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "just text",
      uploadImage,
      ptySend,
      clearInputs,
    });

    expect(uploadImage).toHaveBeenCalledTimes(0);
    expect(ptySend).toHaveBeenCalledTimes(1);
    expect(ptySend).toHaveBeenCalledWith("s1", "/tmp/proj", "just text");
    expect(clearInputs).toHaveBeenCalledTimes(1);
  });

  test("EX10: text + image -> uploadImage resolves before ptySend; single ptySend prompt contains landed path and text", async () => {
    const order: string[] = [];
    const uploadImage = mock(async (_s: string, _b: string, _m: string) => {
      order.push("upload");
      return { path: "/c/landed-image.png" };
    });
    const ptySend = mock((_s: string, _c: string, _p: string) => {
      order.push("ptySend");
    });
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "look here",
      images: [{ base64: "AAAA", mediaType: "image/png" }],
      uploadImage,
      ptySend,
      clearInputs,
    });

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(ptySend).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["upload", "ptySend"]);
    const prompt = (ptySend.mock.calls[0] as unknown as [string, string, string])[2];
    expect(prompt).toContain("look here");
    expect(prompt).toContain("/c/landed-image.png");
  });

  test("EX11: a second send while landing is pending does not call ptySend; after resolve exactly one ptySend total", async () => {
    let resolveUpload: (v: { path: string }) => void = () => {};
    const uploadImage = mock(
      () =>
        new Promise<{ path: string }>((res) => {
          resolveUpload = res;
        }),
    );
    const ptySend = mock(() => {});
    const clearInputs = mock(() => {});

    const args = {
      ...baseArgs(),
      text: "pending",
      images: [{ base64: "AAAA", mediaType: "image/png" }],
      uploadImage,
      ptySend,
      clearInputs,
    };

    // First send: upload is in-flight (pending).
    const p1 = runSend(args);
    // Second send while landing pending: must not fire ptySend.
    const p2 = runSend(args);

    expect(ptySend).toHaveBeenCalledTimes(0);

    resolveUpload({ path: "/c/landed.png" });
    await Promise.all([p1, p2]);

    expect(ptySend).toHaveBeenCalledTimes(1);
  });

  test("EX12: file + image -> single ptySend prompt contains both absolute paths and text", async () => {
    const uploadImage = mock(async () => ({ path: "/c/img.png" }));
    const ptySend = mock(() => {});
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "both attached",
      images: [{ base64: "AAAA", mediaType: "image/png" }],
      fileAbsPaths: ["/c/report.pdf"],
      uploadImage,
      ptySend,
      clearInputs,
    });

    expect(ptySend).toHaveBeenCalledTimes(1);
    const prompt = (ptySend.mock.calls[0] as unknown as [string, string, string])[2];
    expect(prompt).toContain("both attached");
    expect(prompt).toContain("/c/img.png");
    expect(prompt).toContain("/c/report.pdf");
  });
});

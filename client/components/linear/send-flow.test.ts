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
 *     terminalSend?: (sessionId, prompt) => void,   // absent => read-only session
 *     clearInputs: () => void,
 *   }) => Promise<void>
 *
 * Since #25 there is exactly one delivery function: `terminalSend`. Its absence
 * means the session is a read-only history view and nothing at all happens.
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
  test("EX9: plain text -> terminalSend exactly once verbatim, no frame, inputs cleared", async () => {
    const terminalSend = mock(() => {});
    const uploadImage = mock(async () => ({ path: "/never" }));
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "just text",
      uploadImage,
      terminalSend,
      clearInputs,
    });

    expect(uploadImage).toHaveBeenCalledTimes(0);
    expect(terminalSend).toHaveBeenCalledTimes(1);
    expect(terminalSend).toHaveBeenCalledWith("s1", "just text");
    expect(clearInputs).toHaveBeenCalledTimes(1);
  });

  test("EX10: text + image -> uploadImage resolves before terminalSend; single prompt contains landed path and text", async () => {
    const order: string[] = [];
    const uploadImage = mock(async (_s: string, _b: string, _m: string) => {
      order.push("upload");
      return { path: "/c/landed-image.png" };
    });
    const terminalSend = mock((_s: string, _p: string) => {
      order.push("terminalSend");
    });
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "look here",
      images: [{ base64: "AAAA", mediaType: "image/png" }],
      uploadImage,
      terminalSend,
      clearInputs,
    });

    expect(uploadImage).toHaveBeenCalledTimes(1);
    expect(terminalSend).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["upload", "terminalSend"]);
    const prompt = (terminalSend.mock.calls[0] as unknown as [string, string])[1];
    expect(prompt).toContain("look here");
    expect(prompt).toContain("/c/landed-image.png");
  });

  test("EX11: a second send while landing is pending does not call terminalSend; after resolve exactly one total", async () => {
    let resolveUpload: (v: { path: string }) => void = () => {};
    const uploadImage = mock(
      () =>
        new Promise<{ path: string }>((res) => {
          resolveUpload = res;
        }),
    );
    const terminalSend = mock(() => {});
    const clearInputs = mock(() => {});

    const args = {
      ...baseArgs(),
      text: "pending",
      images: [{ base64: "AAAA", mediaType: "image/png" }],
      uploadImage,
      terminalSend,
      clearInputs,
    };

    // First send: upload is in-flight (pending).
    const p1 = runSend(args);
    // Second send while landing pending: must not fire terminalSend.
    const p2 = runSend(args);

    expect(terminalSend).toHaveBeenCalledTimes(0);

    resolveUpload({ path: "/c/landed.png" });
    await Promise.all([p1, p2]);

    expect(terminalSend).toHaveBeenCalledTimes(1);
  });

  test("terminal session -> terminalSend takes the built prompt unflattened", async () => {
    const terminalSend = mock((_s: string, _p: string) => {});
    const uploadImage = mock(async () => ({ path: "/never" }));
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "line1\nline2",
      uploadImage,
      terminalSend,
      clearInputs,
    });

    expect(terminalSend).toHaveBeenCalledTimes(1);
    expect(terminalSend).toHaveBeenCalledWith("s1", "line1\nline2");
    expect(clearInputs).toHaveBeenCalledTimes(1);
  });

  test("read-only session (terminalSend absent) sends nothing, uploads nothing, keeps the draft", async () => {
    const uploadImage = mock(async () => ({ path: "/never" }));
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "hello",
      images: [{ base64: "AAAA", mediaType: "image/png" }],
      fileAbsPaths: ["/c/report.pdf"],
      uploadImage,
      terminalSend: undefined,
      clearInputs,
    });

    expect(uploadImage).toHaveBeenCalledTimes(0);
    expect(clearInputs).toHaveBeenCalledTimes(0);
  });

  test("EX12: file + image -> single prompt contains both absolute paths and text", async () => {
    const uploadImage = mock(async () => ({ path: "/c/img.png" }));
    const terminalSend = mock(() => {});
    const clearInputs = mock(() => {});

    await runSend({
      ...baseArgs(),
      text: "both attached",
      images: [{ base64: "AAAA", mediaType: "image/png" }],
      fileAbsPaths: ["/c/report.pdf"],
      uploadImage,
      terminalSend,
      clearInputs,
    });

    expect(terminalSend).toHaveBeenCalledTimes(1);
    const prompt = (terminalSend.mock.calls[0] as unknown as [string, string])[1];
    expect(prompt).toContain("both attached");
    expect(prompt).toContain("/c/img.png");
    expect(prompt).toContain("/c/report.pdf");
  });
});

import { describe, expect, mock, test } from "bun:test";
import { createSwUpdater } from "./sw-update";

function setup({ controlled = true, waiting = true } = {}) {
  let draft = "";
  const reload = mock(() => {});
  const updater = createSwUpdater({ isIdle: () => draft.trim() === "", reload });

  const container = Object.assign(new EventTarget(), {
    controller: controlled ? {} : null,
  }) as unknown as ServiceWorkerContainer;
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }) as unknown as {
    visibilityState: DocumentVisibilityState;
  } & Document;
  const postMessage = mock((_msg: unknown) => {});
  const update = mock(() => Promise.resolve());
  const registration = {
    waiting: waiting ? { postMessage } : null,
    update,
  } as unknown as ServiceWorkerRegistration;

  updater.track(registration, container, doc);
  return {
    updater,
    reload,
    postMessage,
    update,
    type: (text: string) => {
      draft = text;
    },
    activate: () => container.dispatchEvent(new Event("controllerchange")),
    show: (state: DocumentVisibilityState) => {
      (doc as { visibilityState: DocumentVisibilityState }).visibilityState = state;
      doc.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

describe("swUpdater.atSafeMoment", () => {
  test("asks a waiting worker to activate when the composer is empty", () => {
    const { updater, postMessage } = setup();
    updater.atSafeMoment();
    expect(postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });

  test("leaves a waiting worker alone while a draft is typed", () => {
    const { updater, postMessage, reload, type } = setup();
    type("half a thought");
    updater.atSafeMoment();
    expect(postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  test("does nothing with no worker waiting", () => {
    const { updater, reload } = setup({ waiting: false });
    updater.atSafeMoment();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("the reload after activation", () => {
  test("follows an activation this page asked for", () => {
    const { updater, reload, activate } = setup();
    updater.atSafeMoment();
    activate();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("waits if a draft was started between asking and activation", () => {
    const { updater, reload, activate, type } = setup();
    updater.atSafeMoment();
    type("x");
    activate();
    expect(reload).not.toHaveBeenCalled();
    type("");
    updater.atSafeMoment();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("an activation another tab caused waits for this page's safe moment", () => {
    const { updater, reload, activate, type } = setup();
    type("mid-sentence");
    activate();
    expect(reload).not.toHaveBeenCalled();
    updater.atSafeMoment();
    expect(reload).not.toHaveBeenCalled();
    type("");
    updater.atSafeMoment();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test("the first install claiming an uncontrolled page is not an update", () => {
    const { updater, reload, activate } = setup({ controlled: false, waiting: false });
    activate();
    updater.atSafeMoment();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("update checks", () => {
  test("returning to the foreground checks for a new worker", () => {
    const { update, show } = setup();
    show("hidden");
    expect(update).not.toHaveBeenCalled();
    show("visible");
    expect(update).toHaveBeenCalledTimes(1);
  });
});

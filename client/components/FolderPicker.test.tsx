import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { wsService } from "../services/ws-service";
import { type DirectoryListing, useAppStore } from "../stores/app-store";
import FolderPicker from "./FolderPicker";

const original = wsService.listDirectories;
let calls: string[] = [];
const noop = () => {};

function setPaths(allowedRoots: string[] | null, homeDirectory = "/h") {
  act(() => useAppStore.getState().setServerPaths({ allowedRoots, homeDirectory }));
}
function seed(listing: DirectoryListing | null) {
  act(() => {
    useAppStore.getState().setDirectoryListing(listing);
    useAppStore.getState().setIsLoadingDirectories(false);
  });
}
function open(props: { open?: boolean } = {}) {
  return render(<FolderPicker open={props.open ?? true} onSelect={noop} onClose={noop} />);
}
const byText = (t: string) =>
  Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.trim() === t);
const byTitle = (t: string) =>
  Array.from(document.querySelectorAll(".lin-settings-row-title"))
    .find((e) => e.textContent === t)
    ?.closest("button");
const crumbs = () =>
  Array.from(document.querySelectorAll(".lin-folder-breadcrumb-btn")).map((b) => b.textContent);
const tap = (el: Element | null | undefined) => {
  if (!el) throw new Error("missing element");
  act(() => {
    fireEvent.click(el);
  });
};
const listing = (path: string, parent: string | null, names: string[] = []): DirectoryListing => ({
  path,
  parent,
  entries: names.map((n) => ({ name: n, path: `${path}/${n}` })),
});

beforeEach(() => {
  calls = [];
  wsService.listDirectories = (path: string) => {
    calls.push(path);
    useAppStore.getState().setIsLoadingDirectories(true);
  };
  useAppStore.setState({ directoryListing: null, serverPaths: null, isLoadingDirectories: false });
});

afterEach(() => {
  wsService.listDirectories = original;
  cleanup();
  useAppStore.setState({ directoryListing: null, serverPaths: null, isLoadingDirectories: false });
});

describe("MultiRootOpensOnRootList", () => {
  test("opens on the root list and sends nothing", () => {
    setPaths(["/r1", "/r2"]);
    open();
    expect(byTitle("/r1")).toBeTruthy();
    expect(byTitle("/r2")).toBeTruthy();
    expect(calls).toEqual([]);
  });

  test("duplicate roots collapse", () => {
    setPaths(["/r1", "/r2", "/r1"]);
    open();
    expect(document.querySelectorAll(".lin-folder-item").length).toBe(2);
  });

  test("a same-visit reopen shows the root list, not the stale listing", () => {
    setPaths(["/r1", "/r2"]);
    const r = open();
    tap(byTitle("/r1"));
    seed(listing("/r1", "/", ["stale"]));
    tap(byText("Select This Folder"));
    r.rerender(<FolderPicker open={false} onSelect={noop} onClose={noop} />);
    r.rerender(<FolderPicker open onSelect={noop} onClose={noop} />);
    expect(byTitle("/r1")).toBeTruthy();
    expect(byTitle("/r2")).toBeTruthy();
    expect(document.body.textContent).not.toContain("stale");
    expect(byText("Go Up")).toBeUndefined();
    expect(byText("Select This Folder")).toBeUndefined();
    expect(calls).toEqual(["/r1"]);
  });
});

describe("RootRowListsThatRoot", () => {
  test("each root row lists exactly that root", () => {
    for (const r of ["/r1", "/r2", "/r3"]) {
      calls = [];
      setPaths(["/r1", "/r2", "/r3"]);
      const view = open();
      tap(byTitle(r));
      expect(calls).toEqual([r]);
      view.unmount();
      useAppStore.setState({ isLoadingDirectories: false });
    }
  });

  test("loading, success, empty and error states", () => {
    setPaths(["/r1", "/r2", "/r3"]);
    let selected = "";
    render(<FolderPicker open onSelect={(p) => (selected = p)} onClose={noop} />);
    tap(byTitle("/r2"));
    expect(document.body.textContent).toContain("Loading…");
    expect(byTitle("/r1")).toBeUndefined();

    seed(listing("/r2", "/", ["p"]));
    expect(byText("p")).toBeTruthy();
    const select = byText("Select This Folder") as HTMLButtonElement;
    expect(select.disabled).toBe(false);
    tap(select);
    expect(selected).toBe("/r2");
  });

  test("empty listing reads No subdirectories", () => {
    setPaths(["/r1", "/r2"]);
    open();
    tap(byTitle("/r2"));
    seed(listing("/r2", "/"));
    expect(document.body.textContent).toContain("No subdirectories");
  });

  test("a refused root returns to the root list", () => {
    setPaths(["/r1", "/r2", "/r3"]);
    open();
    tap(byTitle("/r2"));
    act(() => useAppStore.getState().setIsLoadingDirectories(false));
    expect(byTitle("/r1")).toBeTruthy();
    expect(byTitle("/r2")).toBeTruthy();
    expect(byTitle("/r3")).toBeTruthy();
    expect(calls).toEqual(["/r2"]);
  });
});

describe("FewerThanTwoRootsOpenAsBefore", () => {
  test("one root opens that root", () => {
    setPaths(["/r1"]);
    open();
    expect(calls).toEqual(["/r1"]);
    expect(byTitle("/r1")).toBeUndefined();
  });
  test("repeated root counts as one", () => {
    setPaths(["/r1", "/r1"]);
    open();
    expect(calls).toEqual(["/r1"]);
  });
  test("no roots opens home", () => {
    setPaths(null);
    open();
    expect(calls).toEqual(["/h"]);
  });
  test("empty roots opens home", () => {
    setPaths([]);
    open();
    expect(calls).toEqual(["/h"]);
  });
  test("reopening lists again", () => {
    setPaths(["/r1"]);
    const r = open();
    r.rerender(<FolderPicker open={false} onSelect={noop} onClose={noop} />);
    r.rerender(<FolderPicker open onSelect={noop} onClose={noop} />);
    expect(calls).toEqual(["/r1", "/r1"]);
  });
  test("loading shows Loading…", () => {
    setPaths(["/r1"]);
    open();
    expect(document.body.textContent).toContain("Loading…");
  });
});

describe("PickerWaitsForServerPaths", () => {
  test("sends nothing until the paths arrive, then opens the sole root", () => {
    open();
    expect(document.body.textContent).toContain("Loading…");
    expect((byText("Select This Folder") as HTMLButtonElement).disabled).toBe(true);
    expect(calls).toEqual([]);
    setPaths(["/r1"]);
    expect(calls).toEqual(["/r1"]);
  });
  test("late multi-root paths show the root list", () => {
    open();
    setPaths(["/r1", "/r2"]);
    expect(byTitle("/r1")).toBeTruthy();
    expect(byTitle("/r2")).toBeTruthy();
    expect(calls).toEqual([]);
  });
  test("late null roots open home", () => {
    open();
    setPaths(null);
    expect(calls).toEqual(["/h"]);
  });
});

describe("GoUpReturnsToRootList", () => {
  test("Go Up at a root returns to the root list without a request", () => {
    setPaths(["/r1", "/r2"]);
    open();
    seed(listing("/r1", "/"));
    tap(byText("Go Up"));
    expect(byTitle("/r1")).toBeTruthy();
    expect(byTitle("/r2")).toBeTruthy();
    expect(calls).toEqual([]);
    tap(byTitle("/r2"));
    expect(calls).toEqual(["/r2"]);
  });
  test("a root of / still offers Go Up to the list", () => {
    setPaths(["/", "/r2"]);
    open();
    seed(listing("/", null));
    expect(byText("Go Up")).toBeTruthy();
    tap(byText("Go Up"));
    expect(byTitle("/")).toBeTruthy();
    expect(byTitle("/r2")).toBeTruthy();
    expect(calls).toEqual([]);
  });
  test("a late listing after Go Up shows the listing view", () => {
    setPaths(["/r1", "/r2"]);
    open();
    seed(listing("/r1", "/"));
    tap(byText("Go Up"));
    seed(listing("/r1/late", "/r1"));
    expect(crumbs()).toEqual(["r1", "late"]);
    expect(calls).toEqual([]);
  });
  test("a listing held before mount resumes, and Go Up still reaches the list", () => {
    setPaths(["/r1", "/r2"]);
    useAppStore.setState({ directoryListing: listing("/r1", "/") });
    open();
    expect(crumbs()).toEqual(["r1"]);
    tap(byText("Go Up"));
    expect(byTitle("/r1")).toBeTruthy();
    expect(byTitle("/r2")).toBeTruthy();
    expect(calls).toEqual([]);
  });
});

describe("GoUpHiddenWithNowhereToGo", () => {
  test("hidden when the parent leaves the sole root", () => {
    setPaths(["/r1/a"]);
    open();
    seed(listing("/r1/a", "/r1"));
    expect(byText("Go Up")).toBeUndefined();
  });
  test("hidden at the filesystem root with no roots", () => {
    setPaths(null);
    open();
    seed(listing("/", null));
    expect(byText("Go Up")).toBeUndefined();
  });
  test("hidden when the roots are one distinct value", () => {
    setPaths(["/r1", "/r1"]);
    open();
    seed(listing("/r1", "/"));
    expect(byText("Go Up")).toBeUndefined();
  });
});

describe("GoUpToParentInsideRoots", () => {
  test("goes to a parent inside another root", () => {
    setPaths(["/a", "/a/b"]);
    open();
    calls = [];
    seed(listing("/a/b", "/a"));
    tap(byText("Go Up"));
    expect(calls).toEqual(["/a"]);
  });
  test("with no roots goes to any parent", () => {
    setPaths(null);
    open();
    calls = [];
    seed(listing("/h", "/"));
    tap(byText("Go Up"));
    expect(calls).toEqual(["/"]);
  });
  test("with one root goes to a parent inside it", () => {
    setPaths(["/r1"]);
    open();
    calls = [];
    seed(listing("/r1/x", "/r1"));
    tap(byText("Go Up"));
    expect(calls).toEqual(["/r1"]);
  });
  test("is disabled while loading", () => {
    setPaths(["/r1"]);
    open();
    seed(listing("/r1/x", "/r1"));
    act(() => useAppStore.getState().setIsLoadingDirectories(true));
    expect((byText("Go Up") as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("CrumbsStayInsideRoots", () => {
  test("crumbs start at the containing root and tapping one lists it", () => {
    setPaths(["/r1/a", "/r2"]);
    open();
    calls = [];
    seed(listing("/r1/a/b", "/r1/a"));
    expect(crumbs()).toEqual(["a", "b"]);
    tap(document.querySelectorAll(".lin-folder-breadcrumb-btn")[0]);
    expect(calls).toEqual(["/r1/a"]);
  });
  test("a sole root at the listing", () => {
    setPaths(["/r1/a"]);
    open();
    seed(listing("/r1/a", "/r1"));
    expect(crumbs()).toEqual(["a"]);
  });
  test("no roots keeps every crumb", () => {
    setPaths(null);
    open();
    seed(listing("/h/x", "/h"));
    expect(crumbs()).toEqual(["/", "h", "x"]);
  });
  test("a root of / keeps the slash crumb", () => {
    setPaths(["/", "/r2"]);
    open();
    seed(listing("/x", "/"));
    expect(crumbs()).toEqual(["/", "x"]);
  });
  test("nested roots keep their crumbs", () => {
    setPaths(["/a", "/a/b"]);
    open();
    seed(listing("/a/b/c", "/a/b"));
    expect(crumbs()).toEqual(["a", "b", "c"]);
  });
});

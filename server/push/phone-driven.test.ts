/**
 * The scope rule's whole job is telling "I asked for this from my phone" apart
 * from "someone is typing at the keyboard". Every case here is one way those
 * two can be confused.
 */

import { describe, expect, test } from "bun:test";
import { createPhoneDrivenTracker } from "./phone-driven";

const PANE = "w1F:p1";

describe("PhoneDrivenTracker", () => {
  test("a pane nobody has spoken to from the phone is not phone-driven", () => {
    expect(createPhoneDrivenTracker().isPhoneDriven(PANE)).toBe(false);
  });

  test("a prompt sent from the phone survives the turn it starts", () => {
    const t = createPhoneDrivenTracker();

    t.markSent(PANE);
    // The transition the send itself causes must not clear the verdict — that
    // is the trap a plain boolean flag falls into.
    t.onTurnStart(PANE);

    expect(t.isPhoneDriven(PANE)).toBe(true);
  });

  test("a turn that starts with no send from the phone is not the phone's", () => {
    const t = createPhoneDrivenTracker();

    t.onTurnStart(PANE);

    expect(t.isPhoneDriven(PANE)).toBe(false);
  });

  test("typing at the terminal takes a pane back from the phone", () => {
    const t = createPhoneDrivenTracker();

    t.markSent(PANE);
    t.onTurnStart(PANE);
    t.onTurnSettled(PANE);
    expect(t.isPhoneDriven(PANE)).toBe(true);

    // Same pane, next turn, no send from here.
    t.onTurnStart(PANE);

    expect(t.isPhoneDriven(PANE)).toBe(false);
  });

  test("a send while the pane is already working still counts", () => {
    // claude takes input mid-turn, and that send produces no transition — so
    // nothing would ever mark it without the optimistic set.
    const t = createPhoneDrivenTracker();

    t.onTurnStart(PANE); // someone else started this turn
    t.markSent(PANE); // queued from the phone
    t.onTurnSettled(PANE);

    expect(t.isPhoneDriven(PANE)).toBe(true);
  });

  test("a mid-turn send does not credit the phone for the NEXT turn", () => {
    // The reason `onTurnSettled` exists: without it the token from the queued
    // send survives and the following terminal-typed turn reads as the phone's.
    const t = createPhoneDrivenTracker();

    t.onTurnStart(PANE);
    t.markSent(PANE);
    t.onTurnSettled(PANE);

    t.onTurnStart(PANE); // typed at the terminal

    expect(t.isPhoneDriven(PANE)).toBe(false);
  });

  test("panes are tracked apart", () => {
    const t = createPhoneDrivenTracker();

    t.markSent("wA:p1");
    t.onTurnStart("wA:p1");
    t.onTurnStart("wB:p1");

    expect(t.isPhoneDriven("wA:p1")).toBe(true);
    expect(t.isPhoneDriven("wB:p1")).toBe(false);
  });

  test("forgetting a pane drops its verdict", () => {
    const t = createPhoneDrivenTracker();

    t.markSent(PANE);
    t.forget(PANE);

    expect(t.isPhoneDriven(PANE)).toBe(false);
  });

  test("repeated sends before a turn starts are still one turn's worth", () => {
    const t = createPhoneDrivenTracker();

    t.markSent(PANE);
    t.markSent(PANE);
    t.onTurnStart(PANE);
    t.onTurnSettled(PANE);
    t.onTurnStart(PANE); // typed at the terminal

    expect(t.isPhoneDriven(PANE)).toBe(false);
  });
});

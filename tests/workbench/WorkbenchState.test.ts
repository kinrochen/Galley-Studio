import { describe, expect, it } from "vitest";

import {
  initialWorkbenchState,
  reduceWorkbenchState
} from "../../src/workbench/WorkbenchState";

describe("WorkbenchState", () => {
  it("opens a document in visual edit mode without losing source-change state", () => {
    const state = reduceWorkbenchState(initialWorkbenchState(), {
      type: "document-opened",
      path: "notes/a.galley.html",
      sourceChanged: true
    });

    expect(state).toMatchObject({
      phase: "edit",
      mode: "visual",
      documentPath: "notes/a.galley.html",
      sourceChanged: true,
      dirty: false,
      conflict: false
    });
  });

  it("keeps dirty content visible when a conflict is surfaced", () => {
    const dirty = reduceWorkbenchState(initialWorkbenchState(), {
      type: "content-changed"
    });
    expect(reduceWorkbenchState(dirty, { type: "conflict-detected" })).toMatchObject({
      dirty: true,
      conflict: true,
      saving: false
    });
  });

  it("moves among preview, visual, and source modes without fabricating save state", () => {
    const dirty = {
      ...initialWorkbenchState(),
      dirty: true,
      documentPath: "a.galley.html"
    };
    const preview = reduceWorkbenchState(dirty, {
      type: "mode-selected",
      mode: "preview"
    });
    expect(preview).toMatchObject({ mode: "preview", dirty: true });
    expect(
      reduceWorkbenchState(preview, {
        type: "mode-selected",
        mode: "source"
      })
    ).toMatchObject({ mode: "source", dirty: true });
  });

  it("uses the real session dirty state when a save completes", () => {
    const saving = {
      ...initialWorkbenchState(),
      dirty: true,
      saving: true
    };

    expect(reduceWorkbenchState(saving, {
      type: "save-completed",
      dirty: true,
      lastSavedAt: "2026-07-15T00:00:00.000Z",
      sourceChanged: false
    })).toMatchObject({ dirty: true, saving: false });
  });
});

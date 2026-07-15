export type WorkbenchPhase = "generate" | "edit" | "export";
export type WorkbenchMode = "preview" | "visual" | "source";

export interface WorkbenchState {
  phase: WorkbenchPhase;
  mode: WorkbenchMode;
  documentPath: string | null;
  selectedSourceId: string | null;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
  sourceChanged: boolean;
  lastSavedAt: string | null;
  recovery: "ready" | "recovering" | "ambiguous" | "quarantined";
  error: string | null;
}

export type WorkbenchAction =
  | {
      type: "document-opened";
      path: string;
      sourceChanged: boolean;
      mode?: WorkbenchMode;
    }
  | { type: "mode-selected"; mode: WorkbenchMode }
  | { type: "content-changed" }
  | { type: "save-started" }
  | { type: "save-completed"; lastSavedAt: string | null; sourceChanged: boolean }
  | { type: "conflict-detected" }
  | { type: "document-reloaded"; sourceChanged: boolean }
  | { type: "source-selected"; sourceId: string | null }
  | { type: "recovery-started" }
  | { type: "recovery-ambiguous"; message: string }
  | { type: "recovery-quarantined"; message: string }
  | { type: "error"; message: string };

export function initialWorkbenchState(): WorkbenchState {
  return {
    phase: "generate",
    mode: "visual",
    documentPath: null,
    selectedSourceId: null,
    dirty: false,
    saving: false,
    conflict: false,
    sourceChanged: false,
    lastSavedAt: null,
    recovery: "ready",
    error: null
  };
}

export function reduceWorkbenchState(
  state: WorkbenchState,
  action: WorkbenchAction
): WorkbenchState {
  switch (action.type) {
    case "document-opened":
      return {
        ...state,
        phase: "edit",
        mode: action.mode ?? "visual",
        documentPath: action.path,
        dirty: false,
        saving: false,
        conflict: false,
        sourceChanged: action.sourceChanged,
        recovery: "ready",
        error: null
      };
    case "mode-selected":
      return { ...state, mode: action.mode, error: null };
    case "content-changed":
      return { ...state, dirty: true, error: null };
    case "save-started":
      return { ...state, saving: true, error: null };
    case "save-completed":
      return {
        ...state,
        dirty: false,
        saving: false,
        conflict: false,
        sourceChanged: action.sourceChanged,
        lastSavedAt: action.lastSavedAt,
        error: null
      };
    case "conflict-detected":
      return { ...state, saving: false, conflict: true };
    case "document-reloaded":
      return {
        ...state,
        dirty: false,
        saving: false,
        conflict: false,
        sourceChanged: action.sourceChanged,
        error: null
      };
    case "source-selected":
      return { ...state, selectedSourceId: action.sourceId };
    case "recovery-started":
      return { ...state, recovery: "recovering", error: null };
    case "recovery-ambiguous":
      return { ...state, recovery: "ambiguous", error: action.message };
    case "recovery-quarantined":
      return {
        ...state,
        recovery: "quarantined",
        error: action.message
      };
    case "error":
      return { ...state, saving: false, error: action.message };
  }
}

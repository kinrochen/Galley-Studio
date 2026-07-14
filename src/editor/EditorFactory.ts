import type { PlatformCapabilities } from "../platform/PlatformCapabilities";
import type { HtmlEditorAdapter } from "./HtmlEditorAdapter";
import { SourceBodyEditor } from "./SourceBodyEditor";

export class VisualEditorUnavailableError extends Error {
  readonly code = "visual_editor_unavailable" as const;

  constructor() {
    super("Editing is unavailable on this platform");
    this.name = "VisualEditorUnavailableError";
  }
}

export type VisualEditorLoader = () => Promise<HtmlEditorAdapter>;

const loadHugeRteAdapter: VisualEditorLoader = async () => {
  const { HugeRteAdapter } = await import("./HugeRteAdapter");
  return new HugeRteAdapter();
};

export class EditorFactory {
  constructor(private readonly visualLoader: VisualEditorLoader = loadHugeRteAdapter) {}

  async createVisual(capabilities: PlatformCapabilities): Promise<HtmlEditorAdapter> {
    assertEditingAvailable(capabilities);
    return this.visualLoader();
  }

  createSource(capabilities: PlatformCapabilities): HtmlEditorAdapter {
    assertEditingAvailable(capabilities);
    return new SourceBodyEditor();
  }
}

function assertEditingAvailable(capabilities: PlatformCapabilities): void {
  if (!capabilities.canEdit) {
    throw new VisualEditorUnavailableError();
  }
}

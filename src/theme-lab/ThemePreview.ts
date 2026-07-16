import { createSafePreviewFrame } from "../preview/SafeHtmlPreview";

export class ThemePreview {
  render(host: HTMLElement, html: string, title = "Galley Studio custom theme full-page preview"): HTMLIFrameElement {
    const frame = createSafePreviewFrame(host, html, title);
    return frame;
  }
}

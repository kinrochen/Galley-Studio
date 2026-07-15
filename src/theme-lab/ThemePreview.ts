import { createSafePreviewFrame } from "../preview/SafeHtmlPreview";

export class ThemePreview {
  render(host: HTMLElement, html: string): HTMLIFrameElement {
    const frame = createSafePreviewFrame(host, html);
    frame.title = "Galley custom theme full-page preview";
    return frame;
  }
}

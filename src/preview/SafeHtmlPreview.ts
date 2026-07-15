import { sanitizeAuthoringDocument } from "../security/AuthoringSanitizer";

const PREVIEW_CSP = [
  "default-src 'none'",
  "img-src data: blob: app: capacitor: https:",
  "media-src data: blob: app: capacitor: https:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'"
].join("; ");

export function safePreviewHtml(html: string): string {
  const sanitized = sanitizeAuthoringDocument(html).html;
  const document = new DOMParser().parseFromString(sanitized, "text/html");
  for (const unsafe of document.querySelectorAll(
    "script,iframe,frame,frameset,object,embed,form,base"
  )) {
    unsafe.remove();
  }
  const csp = document.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", PREVIEW_CSP);
  const referrer = document.createElement("meta");
  referrer.setAttribute("name", "referrer");
  referrer.setAttribute("content", "no-referrer");
  document.head.prepend(csp, referrer);
  return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
}

export function createSafePreviewFrame(
  host: HTMLElement,
  html: string
): HTMLIFrameElement {
  const frame = host.ownerDocument.createElement("iframe");
  frame.className = "galley-safe-preview";
  frame.title = "Galley article preview";
  frame.setAttribute("sandbox", "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = safePreviewHtml(html);
  host.replaceChildren(frame);
  return frame;
}

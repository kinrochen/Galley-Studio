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
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const normalized = `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
  const sanitized = sanitizeAuthoringDocument(normalized, {
    additionalAttributes: ["data-galley-theme-block"]
  }).html;
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
  const defaults = document.createElement("style");
  defaults.textContent =
    ":root{color-scheme:light;background:#fff}html,body{min-height:100%;background:#fff}body{margin:0}";
  document.head.prepend(csp, referrer, defaults);
  return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
}

export function createSafePreviewFrame(
  host: HTMLElement,
  html: string,
  title = "Galley Studio article preview"
): HTMLIFrameElement {
  const frame = host.ownerDocument.createElement("iframe");
  frame.className = "galley-safe-preview";
  frame.title = title;
  frame.setAttribute("sandbox", "");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.srcdoc = safePreviewHtml(html);
  host.replaceChildren(frame);
  return frame;
}

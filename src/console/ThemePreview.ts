export function createThemePreview(
  themeId: string,
  title: string,
  ariaLabel: string
): HTMLElement {
  const preview = document.createElement("div");
  preview.className = "galley-theme-preview";
  preview.dataset.previewTheme = themeId;
  preview.setAttribute("role", "img");
  preview.setAttribute("aria-label", ariaLabel);

  const paper = document.createElement("div");
  paper.className = "galley-theme-preview__paper";
  const kicker = document.createElement("span");
  kicker.className = "galley-theme-preview__kicker";
  kicker.textContent = "GALLEY";
  const heading = document.createElement("strong");
  heading.textContent = title;
  const rule = document.createElement("span");
  rule.className = "galley-theme-preview__rule";
  const lines = document.createElement("span");
  lines.className = "galley-theme-preview__lines";
  const quote = document.createElement("span");
  quote.className = "galley-theme-preview__quote";
  quote.textContent = "Aa";
  paper.append(kicker, heading, rule, lines, quote);
  preview.append(paper);
  return preview;
}

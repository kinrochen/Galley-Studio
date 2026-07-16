export const WECHAT_ARTICLE_MAX_WIDTH_PX = 677;

/**
 * Galley keeps source-marked blocks as direct children of the article root.
 * The gzh-design Skill normally supplies an outer global section, so Galley
 * maps that section's responsive width contract onto the article itself.
 */
export function applyWechatArticleFrame(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  const article = document.querySelector<HTMLElement>("body > article");
  if (!article) return html;

  const existingStyle = article.getAttribute("style")?.trim();
  const separator = existingStyle && !existingStyle.endsWith(";") ? ";" : "";
  article.setAttribute(
    "style",
    `${existingStyle ?? ""}${separator}` +
      `max-width:${WECHAT_ARTICLE_MAX_WIDTH_PX}px;` +
      "width:100%;margin:0 auto;box-sizing:border-box;"
  );

  return `<!DOCTYPE html>${document.documentElement.outerHTML}`;
}

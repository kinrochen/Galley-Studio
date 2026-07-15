export interface ThemeValidationIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface ThemeValidationReport {
  readonly valid: boolean;
  readonly issues: readonly ThemeValidationIssue[];
}

const REQUIRED_SECTIONS: ReadonlyArray<{
  readonly code: string;
  readonly pattern: RegExp;
  readonly label: string;
}> = [
  {
    code: "component_design_variables",
    pattern: /^##+\s+.*(?:设计变量|design variables)/imu,
    label: "design variables"
  },
  {
    code: "component_html",
    pattern: /^##+\s+.*(?:组件.*HTML|component.*HTML)/imu,
    label: "complete component HTML"
  },
  {
    code: "component_template",
    pattern: /^##+\s+.*(?:完整文章模板骨架|template skeleton)/imu,
    label: "article template skeleton"
  },
  {
    code: "component_recipes",
    pattern: /^##+\s+.*(?:文章类型.*组件组合配方|article type.*recipe)/imu,
    label: "article-type recipes"
  },
  {
    code: "component_mapping",
    pattern: /^##+\s+.*(?:Markdown.*组件映射|Markdown.*mapping)/imu,
    label: "Markdown mapping"
  }
];

const HTML_FENCE = /```html\s*\n([\s\S]*?)```/giu;
const FORBIDDEN_ELEMENTS = new Set(["script", "style", "div", "iframe", "object", "embed", "form"]);

export class ComponentLibraryValidator {
  validate(markdown: string): ThemeValidationReport {
    return this.#validate(markdown, true);
  }

  validateSource(markdown: string): ThemeValidationReport {
    return this.#validate(markdown, false);
  }

  #validate(markdown: string, requireCustomThemeStructure: boolean): ThemeValidationReport {
    const issues: ThemeValidationIssue[] = [];
    if (new TextEncoder().encode(markdown).byteLength > 5 * 1024 * 1024) {
      issues.push(error("component_oversize", "The component library exceeds 5 MiB."));
      return report(issues);
    }

    if (requireCustomThemeStructure) {
      for (const section of REQUIRED_SECTIONS) {
        if (!section.pattern.test(markdown)) {
          issues.push(
            error(section.code, `The component library is missing ${section.label}.`)
          );
        }
      }
    }

    const fences = [...markdown.matchAll(HTML_FENCE)].map((match) => match[1] ?? "");
    if (fences.length === 0) {
      issues.push(error("component_html_missing", "The component library has no HTML component fences."));
    }
    for (const html of fences) {
      this.#validateHtml(html, issues, requireCustomThemeStructure);
    }
    return report(issues);
  }

  #validateHtml(
    html: string,
    issues: ThemeValidationIssue[],
    requireLeaf: boolean
  ): void {
    const template = document.createElement("template");
    template.innerHTML = html;
    for (const element of template.content.querySelectorAll("*")) {
      const tag = element.localName.toLowerCase();
      if (FORBIDDEN_ELEMENTS.has(tag)) {
        issues.push(error(`component_${tag}`, `Component HTML contains forbidden <${tag}>.`));
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        if (
          name === "class" ||
          name === "id" ||
          name.startsWith("on") ||
          (name === "style" && /(?:position\s*:\s*(?:fixed|absolute|sticky)|display\s*:\s*grid|float\s*:|@(?:media|keyframes)|var\s*\()/iu.test(attribute.value))
        ) {
          issues.push(error("component_attribute", `Component HTML contains forbidden attribute or style: ${name}.`));
        }
      }
    }

    if (/white-space\s*:\s*pre/iu.test(html)) {
      issues.push(error("component_white_space_pre", "Component HTML must not use white-space: pre."));
    }
    if (
      /border\s*:\s*[^;{}]*dashed/iu.test(html) &&
      !/text-align\s*:\s*center/iu.test(html)
    ) {
      issues.push({
        code: "component_dashed_border",
        severity: "warning",
        message: "Four-sided dashed borders should be reserved for centered media placeholders."
      });
    }

    if (requireLeaf) {
      const walker = document.createTreeWalker(
        template.content,
        NodeFilter.SHOW_TEXT
      );
      let node = walker.nextNode();
      while (node) {
        if ((node.textContent ?? "").trim()) {
          const parent = node.parentElement;
          if (!parent?.matches('span[leaf=""]')) {
            issues.push(error("component_leaf", "Every component text node must be wrapped by <span leaf=\"\">."));
            break;
          }
        }
        node = walker.nextNode();
      }
    }
  }
}

function error(code: string, message: string): ThemeValidationIssue {
  return { code, severity: "error", message };
}

export function report(issues: readonly ThemeValidationIssue[]): ThemeValidationReport {
  return {
    valid: !issues.some(({ severity }) => severity === "error"),
    issues: Object.freeze([...issues])
  };
}

import { safeCanonicalJson } from "../generation/PromptPayload";
import { sanitizeAuthoringDocument } from "../security/AuthoringSanitizer";
import type { SkillLoadAudit } from "../skill/SkillAudit";
import { validateWechatHtml, type WechatValidationIssue } from "./WechatValidator";

const WECHAT_PROFILE_PATH = "assets/profiles/wechat.md";
const REQUIRED_REPAIR_SKILL_FILES = Object.freeze([
  "SKILL.md",
  "references/theme-index.md",
  WECHAT_PROFILE_PATH
]);
const MAX_ROUNDS = 2;

export interface WechatRepairSkillSession {
  ensureFiles(paths: readonly string[], signal: AbortSignal): Promise<void>;
  completeScoped(prompt: string, signal: AbortSignal): Promise<string>;
  audit?(): SkillLoadAudit;
}

export interface WechatRepairResult {
  readonly html: string;
  readonly rounds: number;
  readonly skillFiles: readonly string[];
}

export interface WechatRepairer {
  repair(html: string, signal: AbortSignal): Promise<WechatRepairResult>;
}

export class WechatRepairService implements WechatRepairer {
  constructor(
    private readonly createSession: (
      signal: AbortSignal
    ) => Promise<WechatRepairSkillSession>
  ) {}

  async repair(html: string, signal: AbortSignal): Promise<WechatRepairResult> {
    throwIfAborted(signal);
    let current = html;
    let validation = validateWechatHtml(current);
    if (validation.valid) return Object.freeze({ html: current, rounds: 0, skillFiles: Object.freeze([]) });

    const session = await this.createSession(signal);
    throwIfAborted(signal);
    await session.ensureFiles(REQUIRED_REPAIR_SKILL_FILES, signal);

    let rounds = 0;
    while (!validation.valid && rounds < MAX_ROUNDS) {
      throwIfAborted(signal);
      const response = await session.completeScoped(
        repairPrompt(current, validation.issues, rounds + 1),
        signal
      );
      throwIfAborted(signal);
      rounds += 1;
      const candidate = sanitizeRepairCandidate(response);
      if (candidate !== null) current = candidate;
      validation = validateWechatHtml(current);
    }

    return Object.freeze({
      html: current,
      rounds,
      skillFiles: Object.freeze(
        session.audit?.().files ?? ["SKILL.md", "references/theme-index.md", WECHAT_PROFILE_PATH]
      )
    });
  }
}

function repairPrompt(
  html: string,
  issues: readonly WechatValidationIssue[],
  round: number
): string {
  return [
    "Repair this COPY for the WeChat export profile. Never change the source Galley document.",
    "Return exactly one <section>...</section> fragment and no Markdown fence or explanation.",
    "Preserve meaning and content. Follow the loaded gzh-design Skill and assets/profiles/wechat.md.",
    "Structured payload (canonical JSON):",
    safeCanonicalJson({
      currentHtml: html,
      currentHtmlLength: html.length,
      issues: issues.map(({ code, message, path }) => ({ code, message, path })),
      repairRound: round
    })
  ].join("\n");
}

function extractSingleSection(response: string): string | null {
  const trimmed = response.trim().replace(/^```(?:html)?\s*/iu, "").replace(/\s*```$/u, "").trim();
  const template = document.createElement("template");
  template.innerHTML = trimmed;
  if (
    template.content.children.length !== 1 ||
    template.content.firstElementChild?.localName !== "section" ||
    [...template.content.childNodes].some(
      (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())
    )
  ) return null;
  return template.content.firstElementChild.outerHTML;
}

function sanitizeRepairCandidate(response: string): string | null {
  const candidate = extractSingleSection(response);
  if (candidate === null) return null;

  try {
    const documentHtml = sanitizeAuthoringDocument(
      `<!doctype html><html><head></head><body>${candidate}</body></html>`
    ).html;
    const parsed = new DOMParser().parseFromString(documentHtml, "text/html");
    const root = parsed.body.firstElementChild;
    if (
      parsed.body.children.length !== 1 ||
      root?.localName !== "section" ||
      [...parsed.body.childNodes].some(
        (node) =>
          node !== root &&
          (node.nodeType !== Node.TEXT_NODE || Boolean(node.textContent?.trim()))
      )
    ) {
      return null;
    }
    return root.outerHTML;
  } catch {
    return null;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

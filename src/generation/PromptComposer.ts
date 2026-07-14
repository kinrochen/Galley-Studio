import GALLEY_AUTHORING_PROFILE from "../../assets/profiles/galley-authoring.md?raw";
import type { SourceResource } from "../source/SourceResourceResolver";
import type { ThemeDefinition } from "../themes/ThemeIndex";
import type {
  GenerationPromptInput,
  PromptValidationIssue,
  RepairPromptInput,
  ThemeDecisionPromptInput
} from "./GenerationTypes";

const THEME_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function composeThemeDecisionPrompt(
  input: ThemeDecisionPromptInput
): string {
  if (input.themes.length === 0) {
    throw new Error("Theme decision requires at least one registered theme");
  }

  const seenIds = new Set<string>();
  const registeredThemes = input.themes.map((theme) => {
    validateThemeReference(theme);
    if (seenIds.has(theme.id)) {
      throw new Error(`Duplicate registered theme id: ${theme.id}`);
    }
    seenIds.add(theme.id);
    return {
      id: theme.id,
      name: theme.name,
      primaryColor: theme.primaryColor,
      useCases: theme.useCases,
      file: theme.file
    };
  });

  return [
    "Use the already-loaded gzh-design Skill to choose exactly one of the registered themes below for this article.",
    "The order is authoritative. The first entry is the Skill's default; choose another only when its registered use cases are a better fit.",
    "The themeId must exactly match an id below, and its registered file is the only component-library path for that choice.",
    "Return only one strict JSON object with exactly these three string properties and no Markdown fence or explanatory prose:",
    "{",
    '  "themeId": "string",',
    '  "articleType": "string",',
    '  "reason": "string"',
    "}",
    "",
    "Registered themes (metadata from the active Skill theme index):",
    JSON.stringify(registeredThemes, null, 2),
    "",
    "Article Markdown:",
    "<article-markdown>",
    input.source.original,
    "</article-markdown>"
  ].join("\n");
}

export function composeGenerationPrompt(input: GenerationPromptInput): string {
  validateThemeReference(input.theme);
  const articleType = input.articleType.trim();
  if (!articleType) {
    throw new Error("Generation prompt requires an article type");
  }

  const resources = (input.resources ?? []).map(promptResource);

  return [
    "Follow the already-loaded gzh-design Skill first, then apply this Galley Authoring profile. The profile changes only the output document contract and does not replace the Skill's theme, component, structure, fidelity, or quality rules.",
    "",
    GALLEY_AUTHORING_PROFILE.trim(),
    "",
    "Generate the article now. You must return one complete HTML document directly.",
    "Do not return JSON or explanatory prose. Do not return a Markdown code fence.",
    'Selected registered theme ID: ' + JSON.stringify(input.theme.id),
    'Selected registered theme file: ' + JSON.stringify(input.theme.file),
    'Article type: ' + JSON.stringify(articleType),
    "The selected theme file is loaded through the active SkillSession. Use that registered component library; do not reproduce or substitute it from another path.",
    "",
    "For every <!-- galley-source:ID --> marker immediately before a Markdown block, render one top-level source block carrying data-galley-source=\"ID\". Preserve all supplied source blocks exactly once and in source order.",
    "",
    "Resolved vault resource metadata (metadata only; no local bytes or system paths are supplied):",
    JSON.stringify(resources, null, 2),
    "",
    "Annotated article Markdown:",
    "<annotated-article-markdown>",
    input.source.promptMarkdown,
    "</annotated-article-markdown>"
  ].join("\n");
}

export function composeRepairPrompt(input: RepairPromptInput): string {
  const issues = input.issues.map(promptIssue);
  const missingSourceBlocks = input.missingSourceBlocks
    .map(
      (block) =>
        `<!-- galley-source:${block.id} -->\n${block.markdown}`
    )
    .join("\n\n");

  return [
    "Repair the current Galley Authoring HTML only for the deterministic validation issues listed below.",
    "Do not rewrite, restyle, reorder, summarize, or otherwise change already-valid content. Preserve every already-valid data-galley-source block byte-for-byte where possible.",
    "Insert each supplied missing source block exactly once in source order and give its rendered top-level block the exact data-galley-source ID.",
    "Keep the document script-free with inline article styles. Return only the repaired complete HTML document with no Markdown code fence, JSON, or explanatory prose.",
    "",
    "Validation issues:",
    JSON.stringify(issues, null, 2),
    "",
    "Current HTML:",
    "<current-html>",
    input.currentHtml,
    "</current-html>",
    "",
    "Missing source blocks:",
    "<missing-source-blocks>",
    missingSourceBlocks,
    "</missing-source-blocks>"
  ].join("\n");
}

function validateThemeReference(theme: ThemeDefinition): void {
  if (!THEME_ID_PATTERN.test(theme.id)) {
    throw new Error(`Invalid registered theme id: ${theme.id}`);
  }
  if (theme.file !== `references/theme-${theme.id}.md`) {
    throw new Error(`Invalid registered theme file: ${theme.file}`);
  }
}

function promptResource(resource: SourceResource): SourceResource {
  return {
    vaultPath: resource.vaultPath,
    alt: resource.alt,
    mediaType: resource.mediaType,
    ...(resource.width === undefined ? {} : { width: resource.width }),
    ...(resource.height === undefined ? {} : { height: resource.height })
  };
}

function promptIssue(issue: PromptValidationIssue): PromptValidationIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    ...(issue.sourceId === undefined ? {} : { sourceId: issue.sourceId }),
    ...(issue.selector === undefined ? {} : { selector: issue.selector })
  };
}

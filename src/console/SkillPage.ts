import { MAX_SKILL_ARCHIVE_BYTES } from "../archive/ArchiveLimits";
import type { GalleyActions } from "./GalleyActions";
import type { ConsolePageText } from "./ConsoleHome";
import { appendText, button } from "./ConsoleHome";
import { heading } from "./ThemePage";

export async function renderSkillPage(
  container: HTMLElement,
  options: {
    actions: GalleyActions;
    text: ConsolePageText;
    confirm: (message: string) => boolean;
    run: (operation: string, action: (signal: AbortSignal) => Promise<unknown>) => Promise<void>;
  }
): Promise<void> {
  heading(container, options.text.t("console.skills.title"));
  appendText(container, options.text.t("console.skills.description"))
    .className = "galley-console__lead";
  const runtime = options.actions.desktop;
  if (!runtime) return;
  const explainer = document.createElement("section");
  explainer.className = "galley-console__skill-explainer";
  const explainerHeading = document.createElement("h2");
  explainerHeading.textContent = options.text.t("console.skills.howItWorks");
  const steps = document.createElement("ol");
  for (const key of [
    "console.skills.step.rules",
    "console.skills.step.theme",
    "console.skills.step.html",
    "console.skills.step.validation"
  ] as const) {
    const item = document.createElement("li");
    item.textContent = options.text.t(key);
    steps.append(item);
  }
  explainer.append(explainerHeading, steps);
  container.append(explainer);
  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = ".zip,application/zip";
  upload.className = "galley-console__file-input";
  upload.dataset.action = "skill-import";
  upload.setAttribute("aria-label", options.text.t("console.skills.import"));
  upload.addEventListener("change", () => {
    const file = upload.files?.[0];
    if (!file) return;
    void options.run("skill-import", async () => {
      if (file.size > MAX_SKILL_ARCHIVE_BYTES) {
        throw new Error("skill_archive_too_large");
      }
      await runtime.importSkill?.(new Uint8Array(await file.arrayBuffer()));
    });
  });
  const uploadTrigger = document.createElement("label");
  uploadTrigger.className = "galley-console__file-trigger";
  uploadTrigger.textContent = options.text.t("console.skills.import");
  uploadTrigger.append(upload);
  container.append(uploadTrigger);
  const skills = (await runtime.listSkills?.()) ?? [];
  if (!skills.length) appendText(container, options.text.t("console.skills.bundled"));
  for (const skill of skills) {
    const row = document.createElement("div");
    row.className = "galley-console__management-row";
    appendText(
      row,
      `${skill.version} - ${options.text.t(
        skill.source === "bundled"
          ? "console.skills.source.bundled"
          : "console.skills.source.imported"
      )} · ${options.text.t(
        skill.valid ? "console.skills.valid" : "console.skills.invalid"
      )}`
    );
    if (skill.active) appendText(row, options.text.t("console.skills.active"));
    else if (skill.source === "imported" && skill.valid) {
      const activate = button(options.text.t("console.skills.activate"), "skill-activate");
      activate.addEventListener("click", () => {
        if (!options.confirm(options.text.t("common.confirm.activate", { target: skill.version }))) return;
        void options.run("skill-activate", async () => runtime.activateSkill?.(skill.version));
      });
      row.append(activate);
    }
    container.append(row);
  }

  const detail = runtime.readActiveSkill
    ? await runtime.readActiveSkill().catch(() => undefined)
    : undefined;
  if (detail) {
    const active = document.createElement("section");
    active.className = "galley-console__skill-detail";
    const title = document.createElement("h2");
    title.textContent = options.text.t("console.skills.current", {
      id: detail.id,
      version: detail.version
    });
    const fileSummary = appendText(active, options.text.t("console.skills.files", {
      count: detail.files.length
    }));
    fileSummary.className = "galley-console__form-help";
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = options.text.t("console.skills.instructions");
    const instructions = document.createElement("pre");
    instructions.textContent = detail.instructions;
    details.append(summary, instructions);
    active.prepend(title);
    active.append(details);
    container.append(active);
  }
}

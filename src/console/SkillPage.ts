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
  const runtime = options.actions.desktop;
  if (!runtime) return;
  const upload = document.createElement("input");
  upload.type = "file";
  upload.accept = ".zip,application/zip";
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
  container.append(upload);
  const skills = (await runtime.listSkills?.()) ?? [];
  if (!skills.length) appendText(container, options.text.t("console.skills.bundled"));
  for (const skill of skills) {
    const row = document.createElement("div");
    row.className = "galley-console__management-row";
    appendText(row, `${skill.version} — ${skill.source}`);
    if (skill.active) appendText(row, options.text.t("console.skills.active"));
    else if (skill.source === "imported") {
      const activate = button(options.text.t("console.skills.activate"), "skill-activate");
      activate.addEventListener("click", () => {
        if (!options.confirm(options.text.t("common.confirm.activate", { target: skill.version }))) return;
        void options.run("skill-activate", async () => runtime.activateSkill?.(skill.version));
      });
      row.append(activate);
    }
    container.append(row);
  }
}

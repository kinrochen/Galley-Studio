import type { LocalizedText } from "../i18n/LocalizedText";
import type { MessageKey } from "../i18n/Resources";
import type {
  GenerationTaskController,
  GenerationTaskSnapshot
} from "../generation/GenerationTask";
import type { GalleyActions } from "./GalleyActions";
import type { ConsoleRoute } from "./ConsoleTypes";

export interface GenerationPageEnvironment {
  readonly actions: GalleyActions;
  readonly task: GenerationTaskController;
  readonly text: LocalizedText;
  readonly navigate: (route: ConsoleRoute) => Promise<void>;
}

const STAGES = [
  "reading",
  "loading-skill",
  "generating",
  "saving"
] as const;

const STAGE_KEYS: Readonly<Record<(typeof STAGES)[number], MessageKey>> = {
  reading: "generation.status.reading",
  "loading-skill": "generation.status.loadingSkill",
  generating: "generation.status.generating",
  saving: "generation.status.saving"
};

export function renderGenerationPage(
  container: HTMLElement,
  environment: GenerationPageEnvironment
): void {
  const snapshot = environment.task.snapshot();
  const section = document.createElement("section");
  section.className = "galley-generation";

  const headingRow = document.createElement("div");
  headingRow.className = "galley-generation__heading";
  const headingCopy = document.createElement("div");
  const heading = document.createElement("h1");
  heading.tabIndex = -1;
  heading.textContent = environment.text.t("console.generation.title");
  const description = document.createElement("p");
  description.className = "galley-console__lead";
  description.textContent = environment.text.t("console.generation.description");
  headingCopy.append(heading, description);
  headingRow.append(headingCopy, statusBadge(snapshot, environment.text));
  section.append(headingRow);

  if (snapshot.status === "idle") {
    const empty = document.createElement("div");
    empty.className = "galley-generation__empty";
    empty.textContent = environment.text.t("console.generation.empty");
    const back = button(environment.text.t("console.generation.new"), "new-generation");
    back.addEventListener("click", () => void environment.navigate("home"));
    empty.append(back);
    section.append(empty);
    container.append(section);
    return;
  }

  const meta = document.createElement("div");
  meta.className = "galley-generation__meta";
  meta.append(
    fact(environment.text.t("console.generation.source"), snapshot.sourcePath ?? "-"),
    fact(environment.text.t("console.generation.elapsed"), duration(snapshot.elapsedMs)),
    fact(environment.text.t("console.generation.rounds"), String(snapshot.turns.length))
  );
  section.append(meta, progress(snapshot, environment.text));

  const conversation = document.createElement("div");
  conversation.className = "galley-generation__conversation";
  conversation.dataset.scrollKey = "generation-conversation";
  conversation.setAttribute("aria-live", "polite");
  conversation.append(systemNotice(snapshot, environment.text));
  if (snapshot.prompt) {
    conversation.append(promptBubble(snapshot.prompt.text, environment.text));
  }
  for (const turn of snapshot.turns) {
    conversation.append(modelBubble(turn, environment.text));
  }
  section.append(conversation);

  if (snapshot.errorMessage) {
    const error = document.createElement("div");
    error.className = "galley-generation__error";
    error.setAttribute("role", "alert");
    const title = document.createElement("strong");
    title.className = "galley-generation__error-title";
    title.textContent = environment.text.t("console.generation.failed");
    const message = document.createElement("p");
    message.className = "galley-generation__error-message";
    message.textContent = snapshot.errorMessage;
    error.append(title, message);
    section.append(error);
  }

  const actions = document.createElement("div");
  actions.className = "galley-generation__actions";
  if (snapshot.status === "running") {
    const cancel = button(environment.text.t("common.action.cancel"), "cancel-generation");
    cancel.addEventListener("click", () => environment.task.cancel());
    actions.append(cancel);
  } else {
    if (snapshot.result?.htmlPath && environment.actions.desktop) {
      const open = button(
        environment.text.t("console.action.openWorkbench"),
        "open-generated"
      );
      open.classList.add("mod-cta");
      open.addEventListener("click", () =>
        void environment.actions.desktop?.openWorkbench(snapshot.result?.htmlPath ?? "")
      );
      actions.append(open);
    }
    const again = button(environment.text.t("console.generation.new"), "new-generation");
    again.addEventListener("click", () => void environment.navigate("home"));
    actions.append(again);
  }
  section.append(actions);
  container.append(section);
}

function progress(
  snapshot: GenerationTaskSnapshot,
  text: LocalizedText
): HTMLElement {
  const list = document.createElement("ol");
  list.className = "galley-generation__progress";
  const current = snapshot.stage ? STAGES.indexOf(snapshot.stage) : -1;
  const completed = snapshot.status === "succeeded";
  STAGES.forEach((stage, index) => {
    const item = document.createElement("li");
    item.className = completed || index < current
      ? "is-complete"
      : index === current
        ? "is-current"
        : "";
    item.textContent = text.t(STAGE_KEYS[stage]).replace(/^\d+\/4\s*/u, "");
    list.append(item);
  });
  return list;
}

function systemNotice(
  snapshot: GenerationTaskSnapshot,
  text: LocalizedText
): HTMLElement {
  const notice = document.createElement("p");
  notice.className = "galley-generation__notice";
  notice.textContent = snapshot.status === "running"
    ? text.t("console.generation.backgroundHint")
    : snapshot.status === "succeeded"
      ? text.t("console.generation.completed", {
          path: snapshot.result?.htmlPath ?? ""
        })
      : snapshot.status === "cancelled"
        ? text.t("console.generation.cancelled")
        : text.t("console.generation.failed");
  return notice;
}

function promptBubble(prompt: string, text: LocalizedText): HTMLElement {
  return messageBubble({
    role: "user",
    avatar: text.t("console.generation.youAvatar"),
    label: text.t("console.generation.prompt"),
    content: prompt,
    scrollKey: "generation-prompt"
  });
}

function modelBubble(
  turn: GenerationTaskSnapshot["turns"][number],
  text: LocalizedText
): HTMLElement {
  const message = messageBubble({
    role: "assistant",
    avatar: text.t("console.generation.agentAvatar"),
    label: text.t("console.generation.modelRound", {
      round: turn.requestId,
      duration: turn.elapsedMs === undefined ? "…" : duration(turn.elapsedMs)
    }),
    content: turn.text || text.t("console.generation.waitingOutput"),
    scrollKey: `generation-turn-${turn.requestId}`,
    waiting: !turn.text
  });
  if (turn.truncated) {
    const truncated = document.createElement("p");
    truncated.className = "galley-generation__truncated";
    truncated.textContent = text.t("console.generation.truncated");
    message.querySelector(".galley-generation__message-body")?.append(truncated);
  }
  return message;
}

function messageBubble(input: {
  readonly role: "user" | "assistant";
  readonly avatar: string;
  readonly label: string;
  readonly content: string;
  readonly scrollKey: string;
  readonly waiting?: boolean;
}): HTMLElement {
  const article = document.createElement("article");
  article.className =
    `galley-generation__message is-${input.role}`;
  const avatar = document.createElement("span");
  avatar.className = "galley-generation__avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = input.avatar;
  const body = document.createElement("div");
  body.className = "galley-generation__message-body";
  const label = document.createElement("header");
  label.textContent = input.label;
  const content = document.createElement("pre");
  content.dataset.scrollKey = input.scrollKey;
  content.textContent = input.content;
  if (input.waiting) content.classList.add("is-waiting");
  body.append(label, content);
  article.append(avatar, body);
  return article;
}

function statusBadge(snapshot: GenerationTaskSnapshot, text: LocalizedText): HTMLElement {
  const badge = document.createElement("span");
  badge.className = `galley-generation__status is-${snapshot.status}`;
  const key: MessageKey = snapshot.status === "running"
    ? "console.generation.running"
    : snapshot.status === "succeeded"
      ? "console.generation.succeeded"
      : snapshot.status === "failed"
        ? "console.generation.failed"
        : snapshot.status === "cancelled"
          ? "console.generation.cancelled"
          : "common.status.idle";
  badge.textContent = text.t(key);
  return badge;
}

function fact(label: string, value: string): HTMLElement {
  const item = document.createElement("span");
  const strong = document.createElement("strong");
  strong.textContent = label;
  item.append(strong, document.createTextNode(value));
  return item;
}

function button(label: string, action: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.dataset.action = action;
  element.textContent = label;
  return element;
}

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

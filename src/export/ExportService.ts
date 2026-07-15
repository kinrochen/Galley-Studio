import { sha256Text } from "../documents/GalleySidecar";
import type { ExportConfiguration } from "./ExportConfiguration";
import {
  GalleyExportRecordV1Schema,
  type GalleyExportRecordV1
} from "./ExportRecord";
import type { ExportProfile, ExportProfileId } from "./ExportProfile";
import { validateWechatHtml } from "./WechatValidator";
import type { WechatRepairer } from "./WechatRepairService";

export interface ExportSource {
  readonly htmlPath: string;
  readonly documentId: string;
  readonly html: string;
}

export interface ExportArtifactWriteInput {
  readonly sourcePath: string;
  readonly configuration: Readonly<ExportConfiguration>;
  readonly profileId: ExportProfileId;
  readonly html: string;
}

export interface ExportArtifactWriter {
  writeNew(input: ExportArtifactWriteInput, signal?: AbortSignal): Promise<{ readonly path: string }>;
}

export interface ExportRecordStore {
  record(record: GalleyExportRecordV1, signal?: AbortSignal): Promise<void>;
}

export interface ExportResult {
  readonly path: string;
  readonly html: string;
  readonly record: GalleyExportRecordV1;
}

export interface ExportServiceOptions {
  readonly profiles: readonly ExportProfile[];
  readonly writer: ExportArtifactWriter;
  readonly recorder: ExportRecordStore;
  readonly repairer?: WechatRepairer;
  readonly now?: () => Date;
  readonly randomUUID?: () => string;
}

export class ExportRecordError extends Error {
  readonly code = "export_record_failed" as const;
  readonly recorded = false;

  constructor(readonly artifactPath: string, readonly cause: unknown) {
    super("The export file was written, but its sidecar record could not be committed.");
    this.name = "ExportRecordError";
  }
}

export class ExportValidationError extends Error {
  readonly code = "export_validation_failed" as const;

  constructor() {
    super("The export copy did not pass deterministic validation.");
    this.name = "ExportValidationError";
  }
}

export class ExportService {
  readonly #profiles: ReadonlyMap<ExportProfileId, ExportProfile>;
  readonly #writer: ExportArtifactWriter;
  readonly #recorder: ExportRecordStore;
  readonly #repairer: WechatRepairer | undefined;
  readonly #now: () => Date;
  readonly #randomUUID: () => string;

  constructor(options: ExportServiceOptions) {
    this.#profiles = new Map(options.profiles.map((profile) => [profile.id, profile]));
    this.#writer = options.writer;
    this.#recorder = options.recorder;
    this.#repairer = options.repairer;
    this.#now = options.now ?? (() => new Date());
    this.#randomUUID = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  }

  async export(
    input: { readonly source: Readonly<ExportSource>; readonly configuration: Readonly<ExportConfiguration> },
    signal: AbortSignal
  ): Promise<Readonly<ExportResult>> {
    throwIfAborted(signal);
    const profile = this.#profiles.get(input.configuration.profileId);
    if (!profile) throw new Error("Unknown Galley export profile.");
    const sourceHtmlHash = await sha256Text(input.source.html);
    throwIfAborted(signal);
    let output = await profile.transform(Object.freeze({
      html: input.source.html,
      provenance: Object.freeze({ documentId: input.source.documentId, sourceHtmlHash })
    }), signal);
    throwIfAborted(signal);

    let repairRounds = 0;
    let skillFiles: readonly string[] = [];
    if (profile.id === "wechat") {
      let validation = validateWechatHtml(output.html);
      if (!validation.valid && this.#repairer) {
        const repaired = await this.#repairer.repair(output.html, signal);
        output = Object.freeze({ ...output, html: repaired.html });
        repairRounds = repaired.rounds;
        skillFiles = repaired.skillFiles;
        validation = validateWechatHtml(output.html);
      }
      if (!validation.valid) throw new ExportValidationError();
    }

    const html = stampProvenance(
      output.html,
      profile.id,
      input.source.documentId,
      sourceHtmlHash
    );
    if (profile.id === "wechat" && !validateWechatHtml(html).valid) {
      throw new ExportValidationError();
    }
    const outputHash = await sha256Text(html);
    throwIfAborted(signal);
    const written = await this.#writer.writeNew({
      sourcePath: input.source.htmlPath,
      configuration: Object.freeze({ ...input.configuration }),
      profileId: profile.id,
      html
    }, signal);

    const record = GalleyExportRecordV1Schema.parse({
      id: this.#randomUUID(),
      configurationId: input.configuration.id,
      profileId: profile.id,
      path: written.path,
      exportedAt: this.#now().toISOString(),
      sourceHtmlHash,
      outputHash,
      repairRounds,
      skillFiles: [...skillFiles]
    });
    Object.freeze(record.skillFiles);
    Object.freeze(record);
    try {
      throwIfAborted(signal);
      await this.#recorder.record(record, signal);
    } catch (error) {
      throw new ExportRecordError(written.path, error);
    }
    return Object.freeze({ path: written.path, html, record });
  }
}

function stampProvenance(
  html: string,
  profileId: ExportProfileId,
  documentId: string,
  sourceHtmlHash: string
): string {
  if (profileId === "wechat") {
    const template = document.createElement("template");
    template.innerHTML = html;
    const root = template.content.firstElementChild;
    if (!root) return html;
    root.setAttribute("data-galley-document-id", documentId);
    root.setAttribute("data-galley-profile", profileId);
    root.setAttribute("data-galley-source-hash", sourceHtmlHash);
    return root.outerHTML;
  }
  if (profileId === "portable-inline") {
    return `<!-- Galley export; document=${documentId}; profile=${profileId}; source-sha256=${sourceHtmlHash} -->${html}`;
  }
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const [name, content] of [
    ["galley-document-id", documentId],
    ["galley-export-profile", profileId],
    ["galley-source-hash", sourceHtmlHash]
  ] as const) {
    const meta = parsed.createElement("meta");
    meta.name = name;
    meta.content = content;
    parsed.head.append(meta);
  }
  return `<!DOCTYPE html>${parsed.documentElement.outerHTML}`;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

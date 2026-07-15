export type ExportProfileId =
  | "standard-web"
  | "portable-inline"
  | "wechat";

export interface ExportProvenance {
  readonly documentId: string;
  readonly sourceHtmlHash: string;
}

export interface ExportProfileInput {
  readonly html: string;
  readonly provenance: Readonly<ExportProvenance>;
}

export interface ExportProfileOutput {
  readonly profileId: ExportProfileId;
  readonly html: string;
  readonly mediaType: "text/html";
}

export interface ExportProfile {
  readonly id: ExportProfileId;
  readonly label: string;
  transform(
    input: Readonly<ExportProfileInput>,
    signal?: AbortSignal
  ): Promise<Readonly<ExportProfileOutput>>;
}

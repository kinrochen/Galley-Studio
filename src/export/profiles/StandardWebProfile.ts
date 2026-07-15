import { sanitizeAuthoringDocument } from "../../security/AuthoringSanitizer";
import type { ExportProfile, ExportProfileInput, ExportProfileOutput } from "../ExportProfile";

export class StandardWebProfile implements ExportProfile {
  readonly id = "standard-web" as const;
  readonly label = "Standard web";

  async transform(input: Readonly<ExportProfileInput>): Promise<Readonly<ExportProfileOutput>> {
    const sanitized = sanitizeAuthoringDocument(input.html).html;
    return Object.freeze({ profileId: this.id, html: sanitized, mediaType: "text/html" as const });
  }
}

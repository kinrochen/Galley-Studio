import { describe, expect, it } from "vitest";

import {
  EMPTY_SAFE_AUTHORING_HTML,
  evaluateCandidate,
  missingSourceBlocksForIssues,
  runRepairLoop
} from "../../src/generation/RepairLoop";
import { annotateMarkdown } from "../../src/source/SourceAnnotator";
import {
  contentTurn,
  makeGenerationHarness,
  validAuthoringHtml,
  validAuthoringHtmlForIds
} from "../support/generationFixtures";

const MARKDOWN = "# Article\n\nFirst paragraph.\n\nSecond paragraph.";

describe("evaluateCandidate", () => {
  it("converts extraction failure into deterministic issues and an empty safe draft", () => {
    const source = annotateMarkdown(MARKDOWN);

    const first = evaluateCandidate("not HTML <script>unsafe()</script>", source);
    const second = evaluateCandidate(
      "not HTML <script>unsafe()</script>",
      source
    );

    expect(first.html).toBe(EMPTY_SAFE_AUTHORING_HTML);
    expect(first.html).not.toContain("unsafe");
    expect(first.validation.valid).toBe(false);
    expect(first.validation.issues[0]).toEqual(
      expect.objectContaining({
        code: "html_extraction_failed",
        severity: "error"
      })
    );
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("returns sanitized bytes and makes every removal a repair error", () => {
    const source = annotateMarkdown(MARKDOWN);
    const unsafe = validAuthoringHtml(source).replace(
      "</article>",
      '<a href="javascript:alert(1)" onclick="alert(1)">bad</a><script>alert(1)</script></article>'
    );

    const candidate = evaluateCandidate(unsafe, source);

    expect(candidate.html).not.toMatch(/javascript:|onclick|<script/i);
    expect(candidate.validation.valid).toBe(false);
    expect(candidate.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsafe_content_removed" })
      ])
    );
  });

  it("does not mutate the annotated source", () => {
    const source = annotateMarkdown(MARKDOWN);
    const before = JSON.stringify(source);

    evaluateCandidate(validAuthoringHtml(source), source);

    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("missingSourceBlocksForIssues", () => {
  it("returns only named source_missing blocks in original source order", () => {
    const source = annotateMarkdown(MARKDOWN);
    const requested = missingSourceBlocksForIssues(source, [
      {
        code: "source_missing",
        severity: "error",
        message: "third",
        sourceId: source.blocks[2]!.id
      },
      {
        code: "source_duplicate",
        severity: "error",
        message: "not a missing block",
        sourceId: source.blocks[0]!.id
      },
      {
        code: "source_missing",
        severity: "error",
        message: "second",
        sourceId: source.blocks[1]!.id
      },
      {
        code: "source_missing",
        severity: "error",
        message: "duplicate issue",
        sourceId: source.blocks[1]!.id
      },
      {
        code: "source_missing",
        severity: "error",
        message: "unknown id",
        sourceId: "invented-999"
      }
    ]);

    expect(requested).toEqual([source.blocks[1], source.blocks[2]]);
  });
});

describe("runRepairLoop", () => {
  it("stops immediately when the first repair validates", async () => {
    const source = annotateMarkdown(MARKDOWN);
    const initial = evaluateCandidate(
      validAuthoringHtmlForIds([source.blocks[0]!.id]),
      source
    );
    const { session, client } = makeGenerationHarness([
      contentTurn(validAuthoringHtml(source)),
      contentTurn("must remain unused")
    ]);

    const repaired = await runRepairLoop({
      session,
      source,
      initial,
      signal: new AbortController().signal
    });

    expect(repaired.validation.valid).toBe(true);
    expect(client.requests).toHaveLength(1);
    expect(client.remainingSteps()).toBe(1);
  });

  it("makes at most two repair calls and returns the last safe candidate", async () => {
    const source = annotateMarkdown(MARKDOWN);
    const invalid = validAuthoringHtmlForIds([source.blocks[0]!.id]);
    const initial = evaluateCandidate(invalid, source);
    const { session, client } = makeGenerationHarness([
      contentTurn(invalid),
      contentTurn(invalid),
      contentTurn("must remain unused")
    ]);

    const repaired = await runRepairLoop({
      session,
      source,
      initial,
      signal: new AbortController().signal
    });

    expect(repaired.validation.valid).toBe(false);
    expect(repaired.html).toContain(source.blocks[0]!.id);
    expect(client.requests).toHaveLength(2);
    expect(client.remainingSteps()).toBe(1);
  });

  it("retains the last sanitized draft when later repair responses cannot be extracted", async () => {
    const source = annotateMarkdown(MARKDOWN);
    const initial = evaluateCandidate(
      validAuthoringHtmlForIds(source.blocks.slice(0, 2).map(({ id }) => id)),
      source
    );
    const { session, client } = makeGenerationHarness([
      contentTurn("first malformed repair"),
      contentTurn("second malformed repair")
    ]);

    const repaired = await runRepairLoop({
      session,
      source,
      initial,
      signal: new AbortController().signal
    });

    expect(repaired.html).toBe(initial.html);
    expect(repaired.html).toContain(source.blocks[0]!.id);
    expect(repaired.validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "html_extraction_failed" }),
        expect.objectContaining({ code: "source_missing" })
      ])
    );
    expect(client.requests).toHaveLength(2);
  });

  it("propagates an already-aborted signal before a repair call", async () => {
    const source = annotateMarkdown(MARKDOWN);
    const initial = evaluateCandidate(
      validAuthoringHtmlForIds([source.blocks[0]!.id]),
      source
    );
    const controller = new AbortController();
    controller.abort();
    const { session, client } = makeGenerationHarness([
      contentTurn("must remain unused")
    ]);

    await expect(
      runRepairLoop({ session, source, initial, signal: controller.signal })
    ).rejects.toMatchObject({ code: "aborted" });
    expect(client.requests).toEqual([]);
  });
});

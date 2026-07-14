import { describe, expect, it } from "vitest";

import { DocumentSession } from "../../src/documents/DocumentSession";
import { GalleyDocumentRepository } from "../../src/documents/GalleyDocumentRepository";
import { GalleyDocumentCodec } from "../../src/documents/GalleyDocumentCodec";
import { HistoryRepository } from "../../src/documents/HistoryRepository";
import {
  GalleySidecarV1Schema,
  sha256Text
} from "../../src/documents/GalleySidecar";
import {
  MemoryWorkbenchVault,
  makeSessionDeps,
  TEST_COPY_ID,
  TEST_NOW,
  TEST_PATHS,
  type MemoryFaultStage,
  type MemoryWorkbenchHooks
} from "../support/workbenchFixtures";

describe("DocumentSession", () => {
  it.each([
    "replace_after_html",
    "replace_after_sidecar",
    "replace_after_commit_marker"
  ] as const)(
    "replays a crashed replacement from durable backing at %s before exposing it",
    async (stage) => {
      const fixture = await makeSessionDeps({
        hooks: { crashStages: new Set<MemoryFaultStage>([stage]) }
      });
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>durable replacement</p></article>");
      const targetHtml = session.html();

      await expect(session.save("explicit")).rejects.toMatchObject({
        name: "MemoryCrashError"
      });

      expect(fixture.backing.rawRead(TEST_PATHS.html)).toBe(targetHtml);
      const rawSidecar = GalleySidecarV1Schema.parse(
        JSON.parse(fixture.backing.rawRead(TEST_PATHS.sidecar) ?? "")
      );
      expect(rawSidecar.htmlHash).toBe(
        stage === "replace_after_html"
          ? fixture.sidecar.htmlHash
          : await sha256Text(targetHtml)
      );
      expect(fixture.backing.journalCount()).toBe(1);

      fixture.vault.destroy();
      const recreatedVault = MemoryWorkbenchVault.reopen(fixture.backing);
      const recreatedRepository = new GalleyDocumentRepository(recreatedVault);
      const recovered = await recreatedRepository.readPair(TEST_PATHS);
      expect(recovered?.html).toBe(
        stage === "replace_after_commit_marker" ? targetHtml : fixture.html
      );
      const recoveredSidecar = GalleySidecarV1Schema.parse(
        JSON.parse(recovered?.sidecarJson ?? "")
      );
      expect(recoveredSidecar.htmlHash).toBe(recovered?.htmlHash);
      expect(fixture.backing.journalCount()).toBe(0);
    }
  );

  it("keeps a failed recovery journal for a later successful adapter reopen", async () => {
    const fixture = await makeSessionDeps({
      hooks: {
        crashStages: new Set<MemoryFaultStage>(["replace_after_html"])
      }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>crash then recover twice</p></article>");
    await expect(session.save("explicit")).rejects.toMatchObject({
      name: "MemoryCrashError"
    });

    fixture.vault.destroy();
    const failedRecovery = MemoryWorkbenchVault.reopen(fixture.backing, {
      faultStages: new Set<MemoryFaultStage>(["replace_rollback_html"])
    });
    await expect(
      new GalleyDocumentRepository(failedRecovery).readPair(TEST_PATHS)
    ).rejects.toThrow("replace_rollback_html");
    expect(fixture.backing.journalCount()).toBe(1);

    failedRecovery.destroy();
    const successfulRecovery = MemoryWorkbenchVault.reopen(fixture.backing);
    const recovered = await new GalleyDocumentRepository(
      successfulRecovery
    ).readPair(TEST_PATHS);
    expect(recovered?.html).toBe(fixture.html);
    expect(fixture.backing.journalCount()).toBe(0);
  });

  it("opens a valid exact-hash pair, trusts the sidecar source path, and exposes body state", async () => {
    const fixture = await makeSessionDeps();

    const session = await DocumentSession.open(fixture.dependencies);

    expect(session.paths()).toEqual(TEST_PATHS);
    expect(session.html()).toBe(fixture.html);
    expect(session.bodyHtml()).toContain("original");
    expect(session.state()).toEqual({
      dirty: false,
      saving: false,
      conflict: false,
      htmlHash: await sha256Text(fixture.html),
      sourceChanged: false,
      lastSavedAt: null
    });
  });

  it.each([
    ["malformed sidecar", "not json", undefined],
    ["strict sidecar failure", JSON.stringify({ schemaVersion: 1 }), undefined],
    ["hash mismatch", undefined, "<p>externally changed bytes</p>"],
    [
      "invalid shell",
      undefined,
      "<!DOCTYPE html><html><head></head><body>x<body>nested</body></html>"
    ]
  ])("rejects %s without opening partial state", async (_label, sidecar, html) => {
    const fixture = await makeSessionDeps();
    if (sidecar !== undefined) {
      fixture.vault.writeExternally(TEST_PATHS.sidecar, sidecar);
    }
    if (html !== undefined) {
      fixture.vault.writeExternally(TEST_PATHS.html, html);
      if (_label === "invalid shell") {
        fixture.vault.writeExternally(
          TEST_PATHS.sidecar,
          JSON.stringify({ ...fixture.sidecar, htmlHash: await sha256Text(html) })
        );
      }
    }

    await expect(DocumentSession.open(fixture.dependencies)).rejects.toThrow();
  });

  it.each([
    ["/absolute/article.galley.html", TEST_PATHS.sidecar],
    ["notes/../article.galley.html", TEST_PATHS.sidecar],
    [TEST_PATHS.html, "notes/article.json"],
    ["notes/a.galley.html", "notes/b.galley.json"]
  ])("rejects invalid or contradictory pair paths %j and %j", async (htmlPath, sidecarPath) => {
    const fixture = await makeSessionDeps();
    await expect(
      DocumentSession.open({
        ...fixture.dependencies,
        htmlPath,
        sidecarPath
      })
    ).rejects.toThrow(/path|pair/i);
  });

  it("treats a missing source deterministically as changed", async () => {
    const fixture = await makeSessionDeps({ source: null });
    const session = await DocumentSession.open(fixture.dependencies);

    expect(session.state().sourceChanged).toBe(true);
  });

  it("updates only the body and retains the fully sanitized document", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    const before = GalleyDocumentCodec.parse(session.html());

    session.updateBody(
      '<article data-galley-role="story"><p onclick="alert(1)" style="color: #123; position: fixed"><a href="javascript:alert(1)">local</a><script>alert(1)</script></p></article>'
    );

    const after = GalleyDocumentCodec.parse(session.html());
    expect(after.doctype).toBe(before.doctype);
    expect(after.lang).toBe(before.lang);
    expect(after.headHtml).toBe(before.headHtml);
    expect(after.bodyHtml).toContain("local");
    expect(after.bodyHtml).toContain('style="color: #123"');
    expect(after.bodyHtml).not.toMatch(
      /onclick|javascript:|<script|position:\s*fixed/i
    );
    expect(session.state().dirty).toBe(true);
  });

  it.each([
    "</body><body><p>smuggled</p>",
    "<!DOCTYPE html><p>smuggled</p>",
    "<html><head></head><body>smuggled</body></html>",
    "<p>safe</p><svg><script>alert(1)</script></svg>",
    "<style>body{display:none}</style></head><body>smuggled"
  ])("rejects shell or foreign-content smuggling in body input: %s", async (body) => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);

    expect(() => session.updateBody(body)).toThrow();
    expect(session.html()).toBe(fixture.html);
    expect(session.state().dirty).toBe(false);
  });

  it("marks dirty only for an effective sanitized change and supports exact revert", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    const originalBody = session.bodyHtml();

    session.updateBody(`${originalBody}<script>alert(1)</script>`);
    expect(session.state().dirty).toBe(false);
    expect(session.html()).toBe(fixture.html);

    session.updateBody("<article><p>changed</p></article>");
    expect(session.state().dirty).toBe(true);
    session.updateBody(originalBody);
    expect(session.state().dirty).toBe(false);
    expect(session.html()).toBe(fixture.html);
  });

  it("performs a clean save as a no-op without history or pair writes", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);

    await session.save("explicit");

    expect(fixture.vault.replaceCalls).toBe(0);
    expect(fixture.vault.historyCreateCalls).toBe(0);
    expect(session.state().lastSavedAt).toBeNull();
  });

  it.each(["auto", "explicit"] as const)(
    "saves %s changes with exact prior history and a matching strict sidecar",
    async (reason) => {
      const fixture = await makeSessionDeps();
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>saved locally</p></article>");
      const expectedHtml = session.html();

      await session.save(reason);

      const savedHtml = fixture.vault.read(TEST_PATHS.html);
      const savedSidecar = GalleySidecarV1Schema.parse(
        JSON.parse(fixture.vault.read(TEST_PATHS.sidecar) ?? "")
      );
      expect(savedHtml).toBe(expectedHtml);
      expect(savedSidecar.htmlHash).toBe(await sha256Text(expectedHtml));
      expect({ ...savedSidecar, htmlHash: fixture.sidecar.htmlHash }).toEqual(
        fixture.sidecar
      );
      expect((await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) => html)).toEqual([
        fixture.html
      ]);
      expect(session.state()).toMatchObject({
        dirty: false,
        conflict: false,
        saving: false,
        htmlHash: await sha256Text(expectedHtml),
        lastSavedAt: TEST_NOW.toISOString()
      });
    }
  );

  it.each(["html", "sidecar", "html ABA", "sidecar ABA"])(
    "blocks autosave after external %s modification, including same-byte identity replacement",
    async (kind) => {
      const fixture = await makeSessionDeps();
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>local</p></article>");

      if (kind === "html") {
        await fixture.replaceExternally("<article><p>external</p></article>");
      } else if (kind === "sidecar") {
        fixture.vault.writeExternally(
          TEST_PATHS.sidecar,
          JSON.stringify({ ...fixture.sidecar, model: "externally-changed" })
        );
      } else if (kind === "html ABA") {
        fixture.vault.writeExternally(TEST_PATHS.html, fixture.html);
      } else {
        fixture.vault.writeExternally(
          TEST_PATHS.sidecar,
          fixture.vault.read(TEST_PATHS.sidecar) ?? ""
        );
      }

      await expect(session.save("auto")).rejects.toMatchObject({
        code: "document_conflict"
      });
      expect(session.state()).toMatchObject({
        dirty: true,
        saving: false,
        conflict: true
      });
      expect(fixture.vault.replaceCalls).toBe(0);
    }
  );

  it("turns a race between re-observation and atomic commit into a typed conflict", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");
    hooks.beforeReplace = async () => {
      delete hooks.beforeReplace;
      await fixture.replacePairExternally("<article><p>raced</p></article>");
    };

    await expect(session.save("explicit")).rejects.toMatchObject({
      code: "document_conflict"
    });
    expect(fixture.vault.read(TEST_PATHS.html)).toContain("raced");
    expect(session.state()).toMatchObject({ dirty: true, conflict: true });
    expect(await fixture.history.list(fixture.sidecar.documentId)).toEqual([]);
    expect(fixture.vault.paths().some((path) => path.endsWith(".pending"))).toBe(
      false
    );
  });

  it("overwrite snapshots the latest external HTML and replaces it with the local pair", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local overwrite</p></article>");
    const localHtml = session.html();
    await fixture.replaceExternally("<article><p>latest external</p></article>");
    const externalHtml = fixture.vault.read(TEST_PATHS.html);

    await session.save("overwrite");

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(localHtml);
    expect((await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) => html)).toEqual([
      externalHtml
    ]);
    expect(session.state()).toMatchObject({ dirty: false, conflict: false });
  });

  it("overwrite adopts the latest valid sidecar identity and provenance policy", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local overwrite</p></article>");
    const localHtml = session.html();
    const latestDocumentId = "01890f8e-7b6d-7cc0-98c4-dc0c0c07398f";
    const latestSourcePath = "notes/relinked.md";
    const latestSource = "# Relinked source\n";
    const latestSidecar = GalleySidecarV1Schema.parse({
      ...fixture.sidecar,
      documentId: latestDocumentId,
      sourcePath: latestSourcePath,
      sourceHash: await sha256Text(latestSource),
      model: "external/provenance-v2"
    });
    fixture.vault.writeExternally(latestSourcePath, latestSource);
    fixture.vault.writeExternally(
      TEST_PATHS.sidecar,
      `${JSON.stringify(latestSidecar, null, 2)}\n`
    );

    await session.save("overwrite");

    const savedSidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.vault.read(TEST_PATHS.sidecar) ?? "")
    );
    expect(savedSidecar).toEqual({
      ...latestSidecar,
      htmlHash: await sha256Text(localHtml)
    });
    expect(
      (await fixture.history.list(latestDocumentId)).map(({ html }) => html)
    ).toEqual([fixture.html]);
    expect(await fixture.history.list(fixture.sidecar.documentId)).toEqual([]);
    expect(session.state()).toMatchObject({
      dirty: false,
      conflict: false,
      sourceChanged: false
    });
  });

  it.each([
    "123E4567-E89B-42D3-A456-426614174000",
    "01890f8e-7b6d-7cc0-98c4-dc0c0c07398f",
    "01890f8e-7b6d-8cc0-98c4-dc0c0c07398f",
    "00000000-0000-0000-0000-000000000000"
  ])("opens and saves sidecar-valid document ID %s", async (documentId) => {
    const fixture = await makeSessionDeps({ documentId });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>uuid compatible</p></article>");

    await session.save("explicit");

    expect(
      (await fixture.history.list(documentId)).map(({ html }) => html)
    ).toEqual([fixture.html]);
    expect(
      fixture.vault
        .paths()
        .filter((path) => path.startsWith(".galley/history/"))
        .every((path) => path.includes(`/${documentId.toLowerCase()}/`))
    ).toBe(true);
  });

  it("keeps the old matching pair and dirty state after an injected atomic commit failure", async () => {
    const hooks: MemoryWorkbenchHooks = { failReplace: true };
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");

    await expect(session.save("explicit")).rejects.toThrow(
      "injected atomic pair replacement failure"
    );

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(fixture.html);
    const sidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.vault.read(TEST_PATHS.sidecar) ?? "")
    );
    expect(sidecar.htmlHash).toBe(await sha256Text(fixture.html));
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
    expect(await fixture.history.list(fixture.sidecar.documentId)).toEqual([]);
  });

  it.each([
    ["after HTML write", ["replace_after_html"]],
    ["after sidecar write", ["replace_after_sidecar"]],
    [
      "during HTML rollback",
      ["replace_after_sidecar", "replace_rollback_html"]
    ],
    [
      "during sidecar rollback",
      ["replace_after_sidecar", "replace_rollback_sidecar"]
    ]
  ] as const)(
    "the transactional reference adapter recovers a matching old pair on failure %s",
    async (_label, stages) => {
      const hooks: MemoryWorkbenchHooks = {
        faultStages: new Set<MemoryFaultStage>(stages)
      };
      const fixture = await makeSessionDeps({ hooks });
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>transactional replacement</p></article>");

      await expect(session.save("explicit")).rejects.toThrow(/injected/i);

      const reopened = MemoryWorkbenchVault.reopen(fixture.backing);
      await new GalleyDocumentRepository(reopened).readPair(TEST_PATHS);
      await expectMatchingPair(reopened, TEST_PATHS);
      expect(reopened.read(TEST_PATHS.html)).toBe(fixture.html);
      expect(
        await new HistoryRepository(reopened).list(fixture.sidecar.documentId)
      ).toEqual([]);
      expect(
        reopened.paths().some((path) => path.endsWith(".pending"))
      ).toBe(false);
      expect(fixture.backing.journalCount()).toBe(0);
    }
  );

  it.each(["replace_after_html", "replace_after_sidecar"] as const)(
    "the transactional reference adapter recovers the old pair on abort at %s",
    async (stage) => {
      const controller = new AbortController();
      const fixture = await makeSessionDeps({
        hooks: {
          abortAtStage: stage,
          abortController: controller
        }
      });
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>abort transaction</p></article>");

      await expect(
        session.save("explicit", controller.signal)
      ).rejects.toMatchObject({ name: "AbortError" });

      await expectMatchingPair(fixture.vault, TEST_PATHS);
      expect(fixture.vault.read(TEST_PATHS.html)).toBe(fixture.html);
      expect(await fixture.history.list(fixture.sidecar.documentId)).toEqual([]);
      expect(fixture.vault.journalCount()).toBe(0);
    }
  );

  it("rejects semantically mismatched caller contents at the repository boundary before writing", async () => {
    const fixture = await makeSessionDeps();
    const observed = await fixture.repository.readPair(TEST_PATHS);
    expect(observed).not.toBeNull();
    const changedHtml = GalleyDocumentCodec.serialize({
      ...GalleyDocumentCodec.parse(fixture.html),
      bodyHtml: "<article><p>repository direct</p></article>"
    });
    const mismatchedSidecar = GalleySidecarV1Schema.parse({
      ...fixture.sidecar,
      htmlHash: fixture.sidecar.htmlHash
    });

    await expect(
      fixture.repository.replacePair(
        TEST_PATHS,
        observed!.observation,
        {
          html: changedHtml,
          sidecarJson: `${JSON.stringify(mismatchedSidecar, null, 2)}\n`
        }
      )
    ).rejects.toThrow(/hash|sidecar|semantic/i);

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(fixture.html);
    expect(fixture.vault.replaceCalls).toBe(0);
  });

  it("fails closed on post-commit verification while leaving a matching new pair", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>new matching pair</p></article>");
    hooks.beforeReplace = () => {
      hooks.verifyReadOverride = null;
    };

    await expect(session.save("explicit")).rejects.toMatchObject({
      code: "document_commit_verification"
    });

    const html = fixture.vault.read(TEST_PATHS.html) ?? "";
    const sidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.vault.read(TEST_PATHS.sidecar) ?? "")
    );
    expect(sidecar.htmlHash).toBe(await sha256Text(html));
    expect(session.state()).toMatchObject({
      dirty: true,
      saving: false,
      conflict: true
    });
    expect(
      (await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) =>
        html
      )
    ).toEqual([fixture.html]);
  });

  it("reload discards local content only after a valid reread and refreshes source status", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local unsaved</p></article>");
    await fixture.replacePairExternally("<article><p>external valid</p></article>");
    fixture.vault.writeExternally(fixture.sidecar.sourcePath, "# Changed source\n");
    await expect(session.save("auto")).rejects.toMatchObject({
      code: "document_conflict"
    });

    await session.reload();

    expect(session.bodyHtml()).toContain("external valid");
    expect(session.state()).toMatchObject({
      dirty: false,
      conflict: false,
      sourceChanged: true
    });
  });

  it("does not discard local state when reload validation fails", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>keep local</p></article>");
    const localHtml = session.html();
    fixture.vault.writeExternally(TEST_PATHS.sidecar, "malformed");

    await expect(session.reload()).rejects.toThrow();

    expect(session.html()).toBe(localHtml);
    expect(session.state().dirty).toBe(true);
  });

  it("saveCopy creates a sanitized matching numbered pair with new identity and leaves the session unchanged", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy me</p></article>");
    const originalHtml = fixture.vault.read(TEST_PATHS.html);
    const originalSidecar = fixture.vault.read(TEST_PATHS.sidecar);
    const beforeState = session.state();
    const beforeSessionHtml = session.html();

    const copyPaths = await session.saveCopy();

    expect(copyPaths).toEqual({
      html: "notes/article-2.galley.html",
      sidecar: "notes/article-2.galley.json"
    });
    const copyHtml = fixture.vault.read(copyPaths.html) ?? "";
    const copySidecar = GalleySidecarV1Schema.parse(
      JSON.parse(fixture.vault.read(copyPaths.sidecar) ?? "")
    );
    expect(copyHtml).toBe(beforeSessionHtml);
    expect(copySidecar.documentId).toBe(TEST_COPY_ID);
    expect(copySidecar.htmlHash).toBe(await sha256Text(copyHtml));
    expect({ ...copySidecar, documentId: fixture.sidecar.documentId, htmlHash: fixture.sidecar.htmlHash }).toEqual(
      fixture.sidecar
    );
    expect(fixture.vault.read(TEST_PATHS.html)).toBe(originalHtml);
    expect(fixture.vault.read(TEST_PATHS.sidecar)).toBe(originalSidecar);
    expect(session.paths()).toEqual(TEST_PATHS);
    expect(session.html()).toBe(beforeSessionHtml);
    expect(session.state()).toEqual(beforeState);
  });

  it("saveCopy skips one-sided collisions and an atomic race without deleting either file", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({
      hooks,
      initialFiles: { "notes/article-2.galley.json": "existing one-sided file" }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    hooks.beforeCreatePair = (paths) => {
      if (paths.html === "notes/article-3.galley.html") {
        fixture.vault.writeExternally(paths.html, "raced HTML");
      }
    };

    const copyPaths = await session.saveCopy();

    expect(copyPaths.html).toBe("notes/article-4.galley.html");
    expect(fixture.vault.read("notes/article-2.galley.json")).toBe(
      "existing one-sided file"
    );
    expect(fixture.vault.read("notes/article-3.galley.html")).toBe("raced HTML");
  });

  it("saveCopy leaves no partial pair after atomic creation failure", async () => {
    const fixture = await makeSessionDeps({
      hooks: { failCreatePair: true }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    const before = fixture.vault.paths();

    await expect(session.saveCopy()).rejects.toThrow(
      "injected atomic pair creation failure"
    );

    expect(fixture.vault.paths()).toEqual(before);
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });

  it.each([
    ["after HTML create", ["create_after_html"]],
    ["after sidecar create", ["create_after_sidecar"]],
    [
      "during HTML cleanup",
      ["create_after_sidecar", "create_cleanup_html"]
    ],
    [
      "during sidecar cleanup",
      ["create_after_sidecar", "create_cleanup_sidecar"]
    ]
  ] as const)(
    "the transactional reference adapter leaves no owned copy member on failure %s",
    async (_label, stages) => {
      const fixture = await makeSessionDeps({
        hooks: { faultStages: new Set<MemoryFaultStage>(stages) }
      });
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>transactional copy</p></article>");

      await expect(session.saveCopy()).rejects.toThrow(/injected/i);

      const reopened = MemoryWorkbenchVault.reopen(fixture.backing);
      await new GalleyDocumentRepository(reopened).readPair(TEST_PATHS);
      expect(reopened.read("notes/article-2.galley.html")).toBeNull();
      expect(reopened.read("notes/article-2.galley.json")).toBeNull();
      await expectMatchingPair(reopened, TEST_PATHS);
      expect(fixture.backing.journalCount()).toBe(0);
    }
  );

  it.each([
    "create_after_html",
    "create_after_sidecar",
    "create_after_commit_marker"
  ] as const)(
    "replays crashed copy creation from durable backing at %s",
    async (stage) => {
      const fixture = await makeSessionDeps({
        hooks: { crashStages: new Set<MemoryFaultStage>([stage]) }
      });
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>crashed copy</p></article>");

      await expect(session.saveCopy()).rejects.toMatchObject({
        name: "MemoryCrashError"
      });
      expect(fixture.backing.journalCount()).toBe(1);

      fixture.vault.destroy();
      const reopened = MemoryWorkbenchVault.reopen(fixture.backing);
      expect(
        await new GalleyDocumentRepository(reopened).readPair({
          html: "notes/article-2.galley.html",
          sidecar: "notes/article-2.galley.json"
        })
      ).toBeNull();
      expect(fixture.backing.journalCount()).toBe(0);
    }
  );

  it.each(["create_after_html", "create_after_sidecar"] as const)(
    "the transactional reference adapter cleans a copy on abort at %s",
    async (stage) => {
      const controller = new AbortController();
      const fixture = await makeSessionDeps({
        hooks: { abortAtStage: stage, abortController: controller }
      });
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>abort copy</p></article>");

      await expect(session.saveCopy(controller.signal)).rejects.toMatchObject({
        name: "AbortError"
      });

      expect(fixture.vault.read("notes/article-2.galley.html")).toBeNull();
      expect(fixture.vault.read("notes/article-2.galley.json")).toBeNull();
      expect(fixture.vault.journalCount()).toBe(0);
    }
  );

  it("saveCopy conditionally cleans its owned pair after verification failure", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    hooks.beforeCreatePair = () => {
      hooks.verifyReadOverride = null;
    };

    await expect(session.saveCopy()).rejects.toMatchObject({
      code: "document_commit_verification"
    });

    expect(fixture.vault.paths()).not.toContain("notes/article-2.galley.html");
    expect(fixture.vault.paths()).not.toContain("notes/article-2.galley.json");
    expect(fixture.vault.removePairCalls).toBe(2);
  });

  it("saveCopy preserves an ABA replacement that appears before cleanup", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");
    hooks.beforeCreatePair = () => {
      hooks.verifyReadOverride = null;
    };
    hooks.beforeRemovePair = (ownership) => {
      fixture.vault.writeExternally(ownership.paths.html, "replacement HTML");
      fixture.vault.writeExternally(
        ownership.paths.sidecar,
        "replacement sidecar"
      );
    };

    await expect(session.saveCopy()).rejects.toMatchObject({
      code: "document_commit_verification"
    });

    expect(fixture.vault.read("notes/article-2.galley.html")).toBe(
      "replacement HTML"
    );
    expect(fixture.vault.read("notes/article-2.galley.json")).toBe(
      "replacement sidecar"
    );
  });

  it.each(["html", "sidecar"] as const)(
    "saveCopy removes the still-owned counterpart after a %s-only cleanup replacement",
    async (member) => {
      const hooks: MemoryWorkbenchHooks = {};
      const fixture = await makeSessionDeps({ hooks });
      const session = await DocumentSession.open(fixture.dependencies);
      session.updateBody("<article><p>copy</p></article>");
      hooks.beforeCreatePair = () => {
        hooks.verifyReadOverride = null;
      };
      hooks.beforeRemovePair = (ownership) => {
        const path =
          member === "html" ? ownership.paths.html : ownership.paths.sidecar;
        fixture.vault.writeExternally(path, `external ${member}`);
      };

      await expect(session.saveCopy()).rejects.toMatchObject({
        code: "document_commit_verification"
      });

      expect(
        fixture.vault.read(
          member === "html"
            ? "notes/article-2.galley.html"
            : "notes/article-2.galley.json"
        )
      ).toBe(`external ${member}`);
      expect(
        fixture.vault.read(
          member === "html"
            ? "notes/article-2.galley.json"
            : "notes/article-2.galley.html"
        )
      ).toBeNull();
      expect(fixture.vault.removePairCalls).toBe(2);
    }
  );

  it("saveCopy rejects a case-only duplicate document ID before creating files", async () => {
    const fixture = await makeSessionDeps({
      randomUUID: () => "123E4567-E89B-42D3-A456-426614174000"
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>copy</p></article>");

    await expect(session.saveCopy()).rejects.toThrow(/new document id/i);

    expect(fixture.vault.createPairCalls).toBe(0);
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });

  it("keeps a newer local revision dirty when editing during an in-flight save", async () => {
    const gate = deferred<void>();
    const fixture = await makeSessionDeps({
      hooks: { beforeReplace: () => gate.promise }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>first local revision</p></article>");
    const firstHtml = session.html();

    const saving = session.save("explicit");
    await Promise.resolve();
    expect(session.state().saving).toBe(true);
    session.updateBody("<article><p>newer local revision</p></article>");
    gate.resolve();
    await saving;

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(firstHtml);
    expect(session.bodyHtml()).toContain("newer local revision");
    expect(session.state()).toMatchObject({
      dirty: true,
      saving: false,
      htmlHash: await sha256Text(firstHtml)
    });
  });

  it("derives clean state from exact content after B to C to B during save", async () => {
    const gate = deferred<void>();
    const fixture = await makeSessionDeps({
      hooks: { beforeReplace: () => gate.promise }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>target B</p></article>");
    const targetBody = session.bodyHtml();

    const saving = session.save("explicit");
    await Promise.resolve();
    session.updateBody("<article><p>intermediate C</p></article>");
    session.updateBody(targetBody);
    gate.resolve();
    await saving;

    expect(session.state()).toMatchObject({ dirty: false, conflict: false });
    expect(fixture.vault.historyCreateCalls).toBe(1);
    await session.save("explicit");
    expect(fixture.vault.historyCreateCalls).toBe(1);
    expect(fixture.vault.replaceCalls).toBe(1);
  });

  it("reconciles edit-back state conservatively after post-commit verification failure", async () => {
    const gate = deferred<void>();
    const hooks: MemoryWorkbenchHooks = {
      beforeReplace: async () => {
        await gate.promise;
        hooks.verifyReadOverride = null;
      }
    };
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    const originalBody = session.bodyHtml();
    session.updateBody("<article><p>committed B</p></article>");
    const committedHtml = session.html();

    const saving = session.save("explicit");
    await Promise.resolve();
    session.updateBody(originalBody);
    expect(session.state().dirty).toBe(false);
    gate.resolve();
    await expect(saving).rejects.toMatchObject({
      code: "document_commit_verification"
    });

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(committedHtml);
    expect(session.html()).toBe(fixture.html);
    expect(session.state()).toMatchObject({ dirty: true, conflict: true });
    expect(
      (await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) =>
        html
      )
    ).toEqual([fixture.html]);
  });

  it("reconciles edit-back state and propagates abort after the pair commit", async () => {
    const gate = deferred<void>();
    const controller = new AbortController();
    const hooks: MemoryWorkbenchHooks = {
      beforeReplace: () => gate.promise,
      afterReplaceCommitted: () => controller.abort()
    };
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    const originalBody = session.bodyHtml();
    session.updateBody("<article><p>committed B</p></article>");
    const committedHtml = session.html();

    const saving = session.save("explicit", controller.signal);
    await Promise.resolve();
    session.updateBody(originalBody);
    gate.resolve();
    await expect(saving).rejects.toMatchObject({ name: "AbortError" });

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(committedHtml);
    expect(session.html()).toBe(fixture.html);
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
    expect(
      (await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) =>
        html
      )
    ).toEqual([fixture.html]);
  });

  it("rolls back provisional history when aborted after history creation but before pair commit", async () => {
    const controller = new AbortController();
    const hooks: MemoryWorkbenchHooks = {
      beforeReplace: () => controller.abort()
    };
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>abort after history</p></article>");

    await expect(
      session.save("explicit", controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(fixture.html);
    expect(await fixture.history.list(fixture.sidecar.documentId)).toEqual([]);
    expect(fixture.vault.paths().some((path) => path.endsWith(".pending"))).toBe(
      false
    );
  });

  it("rolls back provisional history when cancellation is observed immediately after prepare", async () => {
    const controller = new AbortController();
    const fixture = await makeSessionDeps();
    const history = fixture.history;
    const session = await DocumentSession.open({
      ...fixture.dependencies,
      history: {
        async prepare(documentId, html, timestamp, signal) {
          const prepared = await history.prepare(
            documentId,
            html,
            timestamp,
            signal
          );
          controller.abort();
          return prepared;
        },
        commit: (prepared, signal) => history.commit(prepared, signal),
        rollback: (prepared) => history.rollback(prepared)
      }
    });
    session.updateBody("<article><p>abort after prepare returns</p></article>");

    await expect(
      session.save("explicit", controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fixture.vault.replaceCalls).toBe(0);
    expect(await history.list(fixture.sidecar.documentId)).toEqual([]);
    expect(fixture.vault.paths().some((path) => path.endsWith(".pending"))).toBe(
      false
    );
  });

  it("keeps the session dirty and rolls back recognized history when post-commit pruning fails", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    for (let index = 0; index < 20; index += 1) {
      await fixture.history.store(
        fixture.sidecar.documentId,
        `retained-${index}`,
        new Date(1_700_000_000_000 + index)
      );
    }
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>pair commits before prune</p></article>");
    const committedHtml = session.html();
    hooks.failHistoryRemove = true;

    await expect(session.save("explicit")).rejects.toThrow(
      "injected history prune failure"
    );

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(committedHtml);
    await expectMatchingPair(fixture.vault, TEST_PATHS);
    expect(await fixture.history.list(fixture.sidecar.documentId)).toHaveLength(
      20
    );
    expect(fixture.vault.paths().some((path) => path.endsWith(".pending"))).toBe(
      false
    );
    expect(session.state()).toMatchObject({
      dirty: true,
      conflict: true,
      saving: false
    });
  });

  it("rolls back pending history when promotion throws after the pair commit", async () => {
    const fixture = await makeSessionDeps({
      hooks: {
        faultStages: new Set<MemoryFaultStage>(["history_before_promotion"])
      }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>pair commits first</p></article>");

    await expect(session.save("explicit")).rejects.toThrow(
      "history_before_promotion"
    );

    expect(fixture.vault.paths().some((path) => path.endsWith(".pending"))).toBe(
      false
    );
    expect(session.state()).toMatchObject({ dirty: true, conflict: true });
  });

  it.each([
    ["first", new Set(["html"])],
    ["second", new Set(["sidecar"])],
    ["both", new Set(["html", "sidecar"])]
  ] as const)(
    "durably recovers created-member cleanup when the %s removal throws",
    async (_label, failingMembers) => {
      const hooks: MemoryWorkbenchHooks = {};
      const fixture = await makeSessionDeps({ hooks });
      const session = await DocumentSession.open(fixture.dependencies);
      hooks.verifyReadOverride = null;
      hooks.beforeRemovePair = (ownership) => {
        if (failingMembers.has(ownership.member)) {
          throw new Error(`simulated ${ownership.member} cleanup failure`);
        }
      };

      await expect(session.saveCopy()).rejects.toMatchObject({
        code: "document_commit_verification"
      });
      expect(fixture.backing.journalCount()).toBe(1);

      fixture.vault.destroy();
      const reopened = MemoryWorkbenchVault.reopen(fixture.backing);
      await new GalleyDocumentRepository(reopened).readPair(TEST_PATHS);
      expect(
        fixture.backing
          .rawPaths()
          .filter((path) => path.includes("article-2.galley"))
      ).toEqual([]);
      expect(fixture.backing.journalCount()).toBe(0);
    }
  );

  it("replays whole-pair cleanup after a crash between owned members", async () => {
    const hooks: MemoryWorkbenchHooks = {
      crashStages: new Set<MemoryFaultStage>(["owned_cleanup_after_html"])
    };
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    hooks.verifyReadOverride = null;

    await expect(session.saveCopy()).rejects.toMatchObject({
      code: "document_commit_verification"
    });
    expect(fixture.backing.rawRead("notes/article-2.galley.html")).toBeNull();
    expect(
      fixture.backing.rawRead("notes/article-2.galley.json")
    ).not.toBeNull();
    expect(fixture.backing.journalCount()).toBe(1);

    fixture.vault.destroy();
    const reopened = MemoryWorkbenchVault.reopen(fixture.backing);
    await new GalleyDocumentRepository(reopened).readPair(TEST_PATHS);
    expect(
      fixture.backing
        .rawPaths()
        .filter((path) => path.includes("article-2.galley"))
    ).toEqual([]);
    expect(fixture.backing.journalCount()).toBe(0);
  });

  it("preserves an external replacement while replaying failed copy cleanup", async () => {
    const hooks: MemoryWorkbenchHooks = {};
    const fixture = await makeSessionDeps({ hooks });
    const session = await DocumentSession.open(fixture.dependencies);
    hooks.verifyReadOverride = null;
    hooks.beforeRemovePair = (ownership) => {
      if (ownership.member === "html") {
        throw new Error("simulated owned HTML cleanup failure");
      }
    };
    await expect(session.saveCopy()).rejects.toMatchObject({
      code: "document_commit_verification"
    });
    fixture.vault.writeExternally(
      "notes/article-2.galley.html",
      "external replacement HTML"
    );

    fixture.vault.destroy();
    const reopened = MemoryWorkbenchVault.reopen(fixture.backing);
    await new GalleyDocumentRepository(reopened).readPair(TEST_PATHS);
    expect(reopened.read("notes/article-2.galley.html")).toBe(
      "external replacement HTML"
    );
    expect(reopened.read("notes/article-2.galley.json")).toBeNull();
    expect(fixture.backing.journalCount()).toBe(0);
  });

  it("marks ambiguous post-commit state dirty even when history finalization also fails", async () => {
    const gate = deferred<void>();
    const hooks: MemoryWorkbenchHooks = {
      beforeReplace: async () => {
        await gate.promise;
        hooks.verifyReadOverride = null;
      }
    };
    const fixture = await makeSessionDeps({ hooks });
    for (let index = 0; index < 20; index += 1) {
      await fixture.history.store(
        fixture.sidecar.documentId,
        `retained-${index}`,
        new Date(1_700_000_000_000 + index)
      );
    }
    const session = await DocumentSession.open(fixture.dependencies);
    const originalBody = session.bodyHtml();
    session.updateBody("<article><p>committed before two failures</p></article>");
    const committedHtml = session.html();

    const saving = session.save("explicit");
    await Promise.resolve();
    session.updateBody(originalBody);
    hooks.failHistoryRemove = true;
    gate.resolve();
    await expect(saving).rejects.toThrow("injected history prune failure");

    expect(fixture.vault.read(TEST_PATHS.html)).toBe(committedHtml);
    await expectMatchingPair(fixture.vault, TEST_PATHS);
    expect(session.html()).toBe(fixture.html);
    expect(session.state()).toMatchObject({
      dirty: true,
      conflict: true,
      saving: false
    });
  });

  it("keeps history only for the CAS winner across two independent sessions and repositories", async () => {
    const fixture = await makeSessionDeps();
    const repositoryB = new GalleyDocumentRepository(fixture.vault);
    const historyB = new HistoryRepository(fixture.vault, 20);
    const sessionA = await DocumentSession.open(fixture.dependencies);
    const sessionB = await DocumentSession.open({
      ...fixture.dependencies,
      repository: repositoryB,
      history: historyB
    });
    sessionA.updateBody("<article><p>winner A</p></article>");
    sessionB.updateBody("<article><p>loser B</p></article>");

    const results = await Promise.allSettled([
      sessionA.save("explicit"),
      sessionB.save("explicit")
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1
    );
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(
      1
    );
    expect(
      (await fixture.history.list(fixture.sidecar.documentId)).map(({ html }) =>
        html
      )
    ).toEqual([fixture.html]);
    expect(fixture.vault.paths().some((path) => path.endsWith(".pending"))).toBe(
      false
    );
    await expectMatchingPair(fixture.vault, TEST_PATHS);
  });

  it("rejects a concurrent save deterministically while the first save completes", async () => {
    const gate = deferred<void>();
    const fixture = await makeSessionDeps({
      hooks: { beforeReplace: () => gate.promise }
    });
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");

    const first = session.save("explicit");
    await Promise.resolve();
    await expect(session.save("auto")).rejects.toMatchObject({
      code: "document_save_in_progress"
    });
    gate.resolve();
    await first;

    expect(fixture.vault.replaceCalls).toBe(1);
    expect(session.state()).toMatchObject({ dirty: false, saving: false });
  });

  it("propagates abort without writing or clearing dirty state", async () => {
    const fixture = await makeSessionDeps();
    const session = await DocumentSession.open(fixture.dependencies);
    session.updateBody("<article><p>local</p></article>");
    const controller = new AbortController();
    controller.abort();

    await expect(session.save("explicit", controller.signal)).rejects.toMatchObject({
      name: "AbortError"
    });

    expect(fixture.vault.replaceCalls).toBe(0);
    expect(fixture.vault.historyCreateCalls).toBe(0);
    expect(session.state()).toMatchObject({ dirty: true, saving: false });
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function expectMatchingPair(
  vault: { read(path: string): string | null },
  paths: { html: string; sidecar: string }
): Promise<void> {
  const html = vault.read(paths.html);
  const sidecarJson = vault.read(paths.sidecar);
  expect(html).not.toBeNull();
  expect(sidecarJson).not.toBeNull();
  GalleyDocumentCodec.parse(html ?? "");
  const sidecar = GalleySidecarV1Schema.parse(JSON.parse(sidecarJson ?? ""));
  expect(sidecar.htmlHash).toBe(await sha256Text(html ?? ""));
}

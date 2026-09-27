import { describe, expect, it } from "vitest";
import type { VdocListClient } from "../../../../src/renderer/features/vdocs/store";
import { createVdocsStore } from "../../../../src/renderer/features/vdocs/store";

/**
 * Permanent suite. Consumers: VDocList (rows render from docs; create
 * passes through; remove fires) and the use-vdocs push wiring
 * (applyChange is the store's push entry). Pinned: the projection
 * (pushes keep docs current and sorted) and the create contract
 * (template content — the authority requires content from birth).
 * Unpinned: template wording beyond the heading shape, error text
 * (presentation).
 */

function fakeClient(): {
  vdoc: VdocListClient;
  created: Array<{ name: string; content: string }>;
  deleted: string[];
} {
  const docs = new Map<string, number>();
  const created: Array<{ name: string; content: string }> = [];
  const deleted: string[] = [];
  return {
    created,
    deleted,
    vdoc: {
      async list() {
        return {
          docs: [...docs]
            .map(([name, version]) => ({ name, version }))
            .sort((a, b) => (a.name < b.name ? -1 : 1)),
        };
      },
      async create(name, content) {
        created.push({ name, content });
        if (docs.has(name)) {
          return { ok: false as const, error: { code: "exists" as const } };
        }
        docs.set(name, 1);
        return { ok: true as const, doc: { name, version: 1 } };
      },
      async delete(name) {
        deleted.push(name);
        docs.delete(name);
        return { ok: true as const };
      },
    },
  };
}

describe("vdocs store", () => {
  it("refresh pulls the authoritative list", async () => {
    const { vdoc } = fakeClient();
    await vdoc.create("b.md", "x");
    await vdoc.create("a.md", "x");
    const store = createVdocsStore(vdoc);

    await store.getState().refresh();

    expect(store.getState().docs.map((d) => d.name)).toEqual(["a.md", "b.md"]);
  });

  it("create sends template content derived from the name", async () => {
    const fake = fakeClient();
    const store = createVdocsStore(fake.vdoc);

    const result = await store.getState().create("auth-flow.md");

    expect(result).toEqual({
      ok: true,
      doc: { name: "auth-flow.md", version: 1 },
    });
    expect(fake.created).toEqual([
      { name: "auth-flow.md", content: "# Auth Flow\n\n" },
    ]);
  });

  it("applyChange upserts created/written and drops deleted, keeping order", () => {
    const store = createVdocsStore(fakeClient().vdoc);

    store.getState().applyChange({
      kind: "created",
      name: "b.md",
      content: "x",
      version: 1,
      origin: "agent",
    });
    store.getState().applyChange({
      kind: "created",
      name: "a.md",
      content: "x",
      version: 1,
      origin: "user",
    });
    store.getState().applyChange({
      kind: "written",
      name: "b.md",
      content: "y",
      version: 4,
      origin: "agent",
    });
    store.getState().applyChange({ kind: "deleted", name: "a.md" });

    expect(store.getState().docs).toEqual([{ name: "b.md", version: 4 }]);
  });

  it("remove deletes and lets the push (or nothing) reconcile the row", async () => {
    const fake = fakeClient();
    const store = createVdocsStore(fake.vdoc);
    await fake.vdoc.create("a.md", "x"); // seed the authority directly

    await store.getState().remove("a.md");

    expect(fake.deleted).toEqual(["a.md"]);
  });
});

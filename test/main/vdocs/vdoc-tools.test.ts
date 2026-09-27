import { describe, expect, it } from "vitest";
import type { AgentCustomTool } from "../../../src/main/agent/provider.js";
import { VDocStore } from "../../../src/main/vdocs/vdoc-store.js";
import { vdocTools } from "../../../src/main/vdocs/vdoc-tools.js";

/**
 * Permanent suite. Consumers: the provider adapters (pi's customTools,
 * Claude's in-process MCP) hand these tools to the model — so the
 * pinned clauses are the model's contract:
 * - self-describing errors (the recovery path IS the product — a bare
 *   code strands the model mid-turn)
 * - vdoc_write's auto-create and land-on-current-version semantics
 *   (the model never juggles versions)
 * - output prose that names docs and versions (the model's only view)
 * Deliberately unpinned: exact wording beyond the recovery facts,
 * list order (the store's policy). The store's own guarantees are
 * pinned in vdoc-store.test.ts, not re-pinned here.
 */

function makeTools(): {
  store: VDocStore;
  tools: {
    list: AgentCustomTool;
    read: AgentCustomTool;
    write: AgentCustomTool;
  };
} {
  const store = new VDocStore();
  const list = vdocTools(store);
  const byName = new Map(list.map((tool) => [tool.name, tool]));
  return {
    store,
    tools: {
      list: byName.get("vdoc_list") as AgentCustomTool,
      read: byName.get("vdoc_read") as AgentCustomTool,
      write: byName.get("vdoc_write") as AgentCustomTool,
    },
  };
}

const run = (tool: AgentCustomTool, input: unknown) => tool.execute(input);

describe("vdoc_list", () => {
  it("reports that no docs exist yet, pointing at vdoc_write", async () => {
    const { tools } = makeTools();

    const result = await run(tools.list, {});

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("No design docs");
    expect(result.output).toContain("vdoc_write");
  });

  it("lists doc names with their versions", async () => {
    const { store, tools } = makeTools();
    store.create("a.md", "one", "user");
    store.create("b.md", "two", "user");

    const result = await run(tools.list, {});

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("a.md (v1)");
    expect(result.output).toContain("b.md (v1)");
  });
});

describe("vdoc_read", () => {
  it("returns the doc's name, version, and full content", async () => {
    const { store, tools } = makeTools();
    store.create("auth-flow.md", "# Auth", "user");
    store.write("auth-flow.md", "# Auth v2", 1, "agent");

    const result = await run(tools.read, { name: "auth-flow.md" });

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("auth-flow.md (v2)");
    expect(result.output).toContain("# Auth v2");
  });

  it("not-found names the survivors so the model's next call succeeds", async () => {
    const { store, tools } = makeTools();
    store.create("a.md", "one", "user");

    const result = await run(tools.read, { name: "ghost.md" });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("ghost.md");
    expect(result.output).toContain("a.md");
  });

  it("invalid-name teaches the naming rule", async () => {
    const { tools } = makeTools();

    const result = await run(tools.read, { name: "Auth Flow" });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("lowercase");
    expect(result.output).toContain(".md");
  });
});

describe("vdoc_write", () => {
  it("creates a missing doc (auto-create) and reports the version", async () => {
    const { store, tools } = makeTools();

    const result = await run(tools.write, {
      name: "db.md",
      content: "# Schema",
    });

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("db.md");
    expect(result.output).toContain("v1");
    expect(store.read("db.md")).toEqual({
      ok: true,
      value: { content: "# Schema", version: 1 },
    });
  });

  it("replaces an existing doc, always landing on the CURRENT version", async () => {
    const { store, tools } = makeTools();
    store.create("a.md", "v1 content", "agent");
    // The user saves while the agent is composing — the tool must not
    // clobber with a stale base or surface a version dance.
    store.write("a.md", "v2 content", 1, "user");

    const result = await run(tools.write, {
      name: "a.md",
      content: "v3 content",
    });

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("v3");
    expect(store.read("a.md")).toEqual({
      ok: true,
      value: { content: "v3 content", version: 3 },
    });
  });

  it("refuses oversized content with the cap named", async () => {
    const { tools } = makeTools();

    const result = await run(tools.write, {
      name: "big.md",
      content: "x".repeat(10 * 1024 * 1024),
    });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("256 KB");
    expect(result.output).not.toContain("Created big.md");
  });

  it("marks agent origin on every mutation (provenance for the UI)", async () => {
    const { store, tools } = makeTools();
    const origins: string[] = [];
    store.onChange((change) => {
      if (change.kind !== "deleted") origins.push(change.origin);
    });

    await run(tools.write, { name: "a.md", content: "c" });

    expect(origins).toEqual(["agent"]);
  });
});

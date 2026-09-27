import Type from "typebox";
import type { VDocError, VDocName } from "../../shared/ipc/vdoc.js";
import type {
  AgentCustomTool,
  AgentCustomToolResult,
} from "../agent/provider.js";
import type { VDocStore } from "./vdoc-store.js";

/**
 * The model-facing half of the vdoc feature: three tools over the
 * store, defined once against the provider-neutral AgentCustomTool
 * seam. The store owns correctness (atomicity, versions, name
 * validation); THIS module owns ergonomics for a caller that can
 * only read prose:
 * - Self-describing errors. Every failure teaches recovery: the name
 *   rule, the surviving docs, or "re-read and merge". A bare code
 *   would strand the model.
 * - vdoc_write composes read-then-create-or-write INSIDE one
 *   synchronous block, so it always lands on the CURRENT version —
 *   the model never juggles versions itself. Last-write-wins here is
 *   deliberate: the user's protection is the version guard on THEIR
 *   saves (the editor's divergence flow), not the agent's restraint.
 * - No delete, by design: the docs are the user's; the agent drafts
 *   and edits, it does not destroy.
 *
 * The descriptions below are the interface the model learns — they
 * carry the concept (shared, in-memory, never on disk) and the key
 * constraints, because the model never sees this file.
 */
export function vdocTools(store: VDocStore): readonly AgentCustomTool[] {
  return [
    {
      name: "vdoc_list",
      description:
        "List the workspace's virtual design docs (name + version), or report that none exist yet.",
      promptSnippet:
        "list virtual design docs (in-memory scratchpads shared with the user)",
      inputSchema: Type.Object({}),
      async execute(): Promise<AgentCustomToolResult> {
        const docs = store.list();
        if (docs.length === 0) {
          return {
            output: "No design docs yet. Create one with vdoc_write.",
          };
        }
        return {
          output: docs.map((d) => `${d.name} (v${d.version})`).join("\n"),
        };
      },
    },
    {
      name: "vdoc_read",
      description:
        "Read one virtual design doc's full markdown content and its version.",
      promptSnippet: "read one virtual design doc",
      inputSchema: Type.Object({
        name: Type.String({
          description: "The doc's name, e.g. auth-flow.md",
        }),
      }),
      async execute(input): Promise<AgentCustomToolResult> {
        const name = field(input, "name");
        const result = store.read(name);
        if (!result.ok) {
          return { output: explain(result.error, name, store), isError: true };
        }
        return {
          output: `${name} (v${result.value.version})\n\n${result.value.content}`,
        };
      },
    },
    {
      name: "vdoc_write",
      description:
        "Create or replace a virtual design doc — an in-memory markdown scratchpad shared with the user, visible and editable live in their editor. NOT a file: it never touches disk, the file tree, or git, and it vanishes when the app closes. Use it for design notes, plans, and drafts you are building with the user. `name` is a lowercase slug ending in .md (e.g. auth-flow.md). `content` is the complete new markdown content; it replaces the doc's current content.",
      promptSnippet: "create or replace a virtual design doc",
      inputSchema: Type.Object({
        name: Type.String({ description: "The doc's name, e.g. auth-flow.md" }),
        content: Type.String({
          description: "The complete new markdown content",
        }),
      }),
      async execute(input): Promise<AgentCustomToolResult> {
        const name = field(input, "name");
        const content = field(input, "content");
        const read = store.read(name);
        if (read.ok) {
          const written = store.write(
            name,
            content,
            read.value.version,
            "agent",
          );
          if (!written.ok) {
            return {
              output: explain(written.error, name, store),
              isError: true,
            };
          }
          return { output: `Wrote ${name} (v${written.value.version}).` };
        }
        if (read.error.code === "not-found") {
          const created = store.create(name, content, "agent");
          if (!created.ok) {
            return {
              output: explain(created.error, name, store),
              isError: true,
            };
          }
          return { output: `Created ${name} (v${created.value.version}).` };
        }
        return { output: explain(read.error, name, store), isError: true };
      },
    },
  ];
}

/** Defensive field extraction: schema-admitted inputs are strings by
 *  the time execute runs (adapters validate), but the seam's contract
 *  is `unknown` — a non-string degrades into the store's name rule
 *  or empty content rather than a throw. */
function field(input: unknown, key: string): string {
  const value = (input as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "string" ? value : "";
}

/** One error code → one recovery path. The prose is the product: it
 *  names the rule, the survivors, or the merge step, so the model's
 *  next call succeeds without guessing. */
function explain(error: VDocError, name: VDocName, store: VDocStore): string {
  switch (error.code) {
    case "invalid-name":
      return `'${name}' is not a valid design-doc name. Names are lowercase slugs ending in .md — letters, digits, and hyphens, starting alphanumeric, at most 64 characters (e.g. auth-flow.md).`;
    case "not-found": {
      const docs = store.list();
      return docs.length === 0
        ? `No design doc named '${name}' (none exist yet). Create it with vdoc_write.`
        : `No design doc named '${name}'. Existing: ${docs.map((d) => d.name).join(", ")}.`;
    }
    case "conflict":
      return `'${name}' changed since it was last read. vdoc_read it again, merge the edit into the current content, and vdoc_write that.`;
    case "too-large":
      return "Design-doc content exceeds the 256 KB cap. Split the doc or shorten the content.";
    case "exists":
      // Unreachable through these tools (vdoc_write composes
      // read-then-create); kept total so prose never has a hole.
      return `A design doc named '${name}' already exists.`;
  }
}

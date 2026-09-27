import { describe, expect, it } from "vitest";
import { VDocStore } from "../../../src/main/vdocs/vdoc-store.js";

/**
 * Permanent suite. Each clause names a consumer in source (imminent:
 * the IPC glue and the agent vdoc tools both build on this store):
 * - failures-as-values            -> glue passes results through
 * - version-guarded writes        -> the editor's divergence flow and
 *   the tool's read-then-write compose
 * - atomic failures (no change)   -> both consumers assume a failed
 *   call leaves nothing behind
 * - change payloads in full       -> the wire push maps 1:1
 * Deliberately unpinned: list order (policy), the exact size cap and
 * name-length cap (policy — tests use content/names far outside any
 * plausible cap), and error prose (the tool layer owns model-facing
 * text). Re-pin triggers: persistence (kills the dies-with-process
 * clause), history/undo (reinterprets version).
 */

/** Unwrap: a test is a caller, and callers demand promises. */
function unwrap<T>(
  result: { ok: true; value: T } | { ok: false; error: { code: string } },
): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
}

/** The compose pattern the agent tool will use: read, then
 *  create-or-write against the version just observed. */
function put(store: VDocStore, name: string, content: string): number {
  const read = store.read(name);
  if (read.ok) {
    return unwrap(store.write(name, content, read.value.version, "agent"))
      .version;
  }
  return unwrap(store.create(name, content, "agent")).version;
}

describe("VDocStore.create", () => {
  it("creates a doc with content from birth at version 1", () => {
    const store = new VDocStore();

    const meta = unwrap(store.create("auth-flow.md", "# Auth", "user"));

    expect(meta).toEqual({ name: "auth-flow.md", version: 1 });
    const read = unwrap(store.read("auth-flow.md"));
    expect(read.content).toBe("# Auth");
    expect(read.version).toBe(1);
  });

  it("rejects a second create under the same name with exists, changing nothing", () => {
    const store = new VDocStore();
    store.create("a.md", "first", "user");

    const result = store.create("a.md", "second", "agent");

    expect(result).toEqual({ ok: false, error: { code: "exists" } });
    expect(unwrap(store.read("a.md")).content).toBe("first");
  });

  it("rejects malformed names with invalid-name", () => {
    const store = new VDocStore();
    const bad = [
      "", // empty
      "Auth-Flow.md", // uppercase
      "auth flow.md", // space
      "design/auth.md", // separator — not a filesystem path
      "..md", // traversal-shaped
      "auth-flow", // missing .md
      "auth-flow.txt", // wrong suffix
      `${"x".repeat(200)}.md`, // beyond any plausible length cap
    ];
    for (const name of bad) {
      expect(store.create(name, "c", "user")).toEqual({
        ok: false,
        error: { code: "invalid-name" },
      });
    }
    expect(store.list()).toEqual([]);
  });

  it("refuses content far beyond any plausible size cap, changing nothing", () => {
    const store = new VDocStore();
    const huge = "x".repeat(10 * 1024 * 1024);

    const created = store.create("big.md", huge, "user");
    const written = (() => {
      store.create("small.md", "s", "user");
      return store.write("small.md", huge, 1, "agent");
    })();

    expect(created).toEqual({ ok: false, error: { code: "too-large" } });
    expect(written).toEqual({ ok: false, error: { code: "too-large" } });
    expect(unwrap(store.read("small.md")).content).toBe("s");
    expect(store.list().map((m) => m.name)).toEqual(["small.md"]);
  });
});

describe("VDocStore.write", () => {
  it("replaces content and bumps the version (read-after-write)", () => {
    const store = new VDocStore();
    put(store, "a.md", "one");

    const meta = unwrap(store.write("a.md", "two", 1, "agent"));

    expect(meta.version).toBe(2);
    const read = unwrap(store.read("a.md"));
    expect(read.content).toBe("two");
    expect(read.version).toBe(2);
  });

  it("rejects a stale expectedVersion with conflict, leaving the doc untouched", () => {
    const store = new VDocStore();
    put(store, "a.md", "base");
    unwrap(store.write("a.md", "current", 1, "user"));

    // A writer holding version 1 races the version-2 write above.
    const result = store.write("a.md", "stale", 1, "agent");

    expect(result).toEqual({ ok: false, error: { code: "conflict" } });
    const read = unwrap(store.read("a.md"));
    expect(read.content).toBe("current");
    expect(read.version).toBe(2);
  });

  it("rejects writes to absent docs with not-found (no auto-create)", () => {
    const store = new VDocStore();

    expect(store.write("ghost.md", "c", 1, "user")).toEqual({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("counts versions monotonically across a write sequence", () => {
    const store = new VDocStore();
    let version = put(store, "a.md", "v1");

    for (let i = 2; i <= 6; i++) {
      version = unwrap(store.write("a.md", `v${i}`, version, "user")).version;
      expect(version).toBe(i);
    }
  });
});

describe("VDocStore.read", () => {
  it("answers not-found for absent docs and invalid-name for malformed ones", () => {
    const store = new VDocStore();
    put(store, "a.md", "c");

    expect(store.read("ghost.md")).toEqual({
      ok: false,
      error: { code: "not-found" },
    });
    expect(store.read("Nope.md")).toEqual({
      ok: false,
      error: { code: "invalid-name" },
    });
  });
});

describe("VDocStore.list", () => {
  it("reflects creates and deletes (order is policy — compared as sets)", () => {
    const store = new VDocStore();
    put(store, "a.md", "1");
    put(store, "b.md", "2");
    put(store, "c.md", "3");
    unwrap(store.delete("b.md"));

    const names = store
      .list()
      .map((m) => m.name)
      .sort();

    expect(names).toEqual(["a.md", "c.md"]);
    expect(store.list().every((m) => m.version >= 1)).toBe(true);
  });
});

describe("VDocStore.delete", () => {
  it("removes the doc (subsequent reads answer not-found)", () => {
    const store = new VDocStore();
    put(store, "a.md", "c");

    const result = store.delete("a.md");

    expect(result.ok).toBe(true);
    expect(store.read("a.md")).toEqual({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("answers not-found for absent docs and invalid-name for malformed ones", () => {
    const store = new VDocStore();

    expect(store.delete("ghost.md")).toEqual({
      ok: false,
      error: { code: "not-found" },
    });
    expect(store.delete("BAD.md")).toEqual({
      ok: false,
      error: { code: "invalid-name" },
    });
  });
});

describe("VDocStore.onChange", () => {
  it("fires exactly once per successful mutation with the full payload", () => {
    const store = new VDocStore();
    const changes: unknown[] = [];
    store.onChange((change) => changes.push(change));

    put(store, "a.md", "one");
    unwrap(store.write("a.md", "two", 1, "agent"));
    unwrap(store.delete("a.md"));

    expect(changes).toEqual([
      {
        kind: "created",
        name: "a.md",
        content: "one",
        version: 1,
        origin: "agent",
      },
      {
        kind: "written",
        name: "a.md",
        content: "two",
        version: 2,
        origin: "agent",
      },
      { kind: "deleted", name: "a.md" },
    ]);
  });

  it("never fires on failed operations", () => {
    const store = new VDocStore();
    const changes: unknown[] = [];
    store.onChange((change) => changes.push(change));
    put(store, "a.md", "base");

    changes.length = 0;
    store.create("a.md", "again", "user"); // exists
    store.write("a.md", "stale", 99, "user"); // conflict
    store.write("ghost.md", "c", 1, "user"); // not-found
    store.create("BAD.md", "c", "user"); // invalid-name
    store.read("ghost.md"); // failure, and a read regardless

    expect(changes).toEqual([]);
  });

  it("stops delivery after unsubscribe", () => {
    const store = new VDocStore();
    const seen: string[] = [];
    const unsubscribe = store.onChange((c) =>
      seen.push(c.kind === "deleted" ? "deleted" : c.kind),
    );

    put(store, "a.md", "one");
    unsubscribe();
    put(store, "b.md", "two");

    expect(seen).toEqual(["created"]);
  });

  it("contains a throwing listener: the mutation stands and other subscribers still hear", () => {
    const store = new VDocStore();
    const seen: string[] = [];
    store.onChange(() => {
      throw new Error("faulty subscriber");
    });
    store.onChange((c) => seen.push(c.kind === "deleted" ? "deleted" : c.kind));

    const result = store.create("a.md", "c", "user");

    expect(result.ok).toBe(true);
    expect(seen).toEqual(["created"]);
    expect(unwrap(store.read("a.md")).content).toBe("c");
  });
});

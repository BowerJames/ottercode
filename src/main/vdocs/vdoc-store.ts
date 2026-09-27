import type {
  VDocChange,
  VDocContent,
  VDocError,
  VDocMeta,
  VDocName,
  VDocOrigin,
} from "../../shared/ipc/vdoc.js";

/**
 * The result wrapper. Failures are values, not throws — the same
 * shape the wire payloads use, so IPC glue passes results through
 * mechanically instead of catching and mapping (logic in glue is
 * forbidden). The generic `value` arm is store-internal; the wire
 * inlines its fields, per the fs-domain style.
 */
export type VDocResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: VDocError };

/**
 * The authority on virtual design documents: in-memory documents the
 * user and the agent edit together, playing the role disk plays for
 * real files — the source of truth renderer buffers keep up with.
 * Both writers cross this one interface: the user through IPC glue,
 * the agent through custom tools. Nothing below either path knows
 * about the other.
 *
 * Interface facts every caller relies on:
 * - Docs never touch disk. The store's state dies with the process —
 *   that is the feature ("not persisted"), not an accident.
 * - Operations are synchronous and atomic: each either lands whole
 *   or changes nothing (a failed op leaves content, version, list,
 *   and listeners exactly as they were). Cross-call read-modify-
 *   write sequences are guarded by expectedVersion — a stale base
 *   yields `conflict`, never a silent clobber. This matters because
 *   the agent runtime may invoke tools in parallel.
 * - Version counts successful mutations; create establishes 1. It is
 *   a counter, not a history — there is no undo and no old content.
 * - Names are validated here, once, for every operation: the rule is
 *   the VDocName contract (lowercase slug, `.md`, ≤64 chars). No doc
 *   can ever exist under a name the rule rejects.
 * - Content is capped (MAX_CONTENT_BYTES, UTF-8) — the change events
 *   carry whole content, so a runaway write must stop at the door.
 * - Validation order is name, then content, then state (exists /
 *   version): input errors are answered before state errors.
 * - Change listeners fire synchronously, exactly once per successful
 *   mutation, after the state has settled — and never on failure. A
 *   throwing listener is contained: it cannot fail the mutation or
 *   starve other subscribers.
 */
export class VDocStore {
  private readonly docs = new Map<
    VDocName,
    { content: string; version: number }
  >();
  private readonly listeners = new Set<(change: VDocChange) => void>();

  /** Creates a doc with content from birth — there is no empty
   *  genesis state every reader would have to handle. Rejects
   *  malformed names, oversized content, and existing names. */
  create(
    name: VDocName,
    content: string,
    origin: VDocOrigin,
  ): VDocResult<VDocMeta> {
    const input = invalidInput(name, content);
    if (input !== undefined) return fail(input);
    if (this.docs.has(name)) return fail({ code: "exists" });
    this.docs.set(name, { content, version: 1 });
    return this.emit(
      {
        kind: "created",
        name,
        content,
        version: 1,
        origin,
      },
      { name, version: 1 },
    );
  }

  /** All docs, sorted by name. Order is policy, not obligation —
   *  callers must not depend on it (mirrors the fs domain's stance). */
  list(): readonly VDocMeta[] {
    return [...this.docs]
      .map(([name, doc]) => ({ name, version: doc.version }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** The doc's whole content and the version a subsequent write must
   *  name. Malformed and absent names are both errors (invalid-name /
   *  not-found) — uniform validation at the choke point. */
  read(name: VDocName): VDocResult<VDocContent> {
    const invalid = invalidName(name);
    if (invalid !== undefined) return fail(invalid);
    const doc = this.docs.get(name);
    if (doc === undefined) return fail({ code: "not-found" });
    return { ok: true, value: { content: doc.content, version: doc.version } };
  }

  /** Replaces the content of an existing doc. No auto-create: the
   *  agent tool composes read → create-or-write over these strict
   *  single-purpose ops. `expectedVersion` must be the version the
   *  caller's content is based on; anything else is `conflict` with
   *  the store untouched. */
  write(
    name: VDocName,
    content: string,
    expectedVersion: number,
    origin: VDocOrigin,
  ): VDocResult<VDocMeta> {
    const input = invalidInput(name, content);
    if (input !== undefined) return fail(input);
    const doc = this.docs.get(name);
    if (doc === undefined) return fail({ code: "not-found" });
    if (doc.version !== expectedVersion) return fail({ code: "conflict" });
    doc.content = content;
    doc.version += 1;
    return this.emit(
      {
        kind: "written",
        name,
        content,
        version: doc.version,
        origin,
      },
      { name, version: doc.version },
    );
  }

  /** Removes a doc. Unconditional by design: v1's only delete caller
   *  is the user, whose deletion is authoritative intent — a racing
   *  writer simply sees `not-found` on its next write, which the
   *  editor already handles. The agent toolset exposes no delete. */
  delete(name: VDocName): VDocResult<null> {
    const invalid = invalidName(name);
    if (invalid !== undefined) return fail(invalid);
    if (!this.docs.delete(name)) return fail({ code: "not-found" });
    return this.emit({ kind: "deleted", name }, null);
  }

  /** The change seam: IPC push and tests subscribe here. Returns the
   *  unsubscribe function. */
  onChange(listener: (change: VDocChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Commits a mutation's result and notifies — after the state has
   *  settled, contained per listener. The single exit path for
   *  success keeps "fire exactly once, never on failure" true by
   *  construction. */
  private emit<T>(change: VDocChange, value: T): VDocResult<T> {
    for (const listener of this.listeners) {
      try {
        listener(change);
      } catch {
        // Contained: a faulty subscriber must not fail the mutation
        // (state is already committed) or starve the others.
      }
    }
    return { ok: true, value };
  }
}

/** Name rule: see the VDocName contract. Checked before anything
 *  else in every operation — one choke point, every adapter
 *  inherits it. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*\.md$/;
const MAX_NAME_LENGTH = 64;

/** The content cap, in UTF-8 bytes — the honest measure of what the
 *  change events and the wire carry. Policy, not law. */
const MAX_CONTENT_BYTES = 256 * 1024;

function invalidName(name: VDocName): VDocError | undefined {
  if (name.length > MAX_NAME_LENGTH || !NAME_PATTERN.test(name)) {
    return { code: "invalid-name" };
  }
  return undefined;
}

/** Input validation, name before content (the documented order). */
function invalidInput(name: VDocName, content: string): VDocError | undefined {
  return invalidName(name) ?? sizeError(content);
}

function sizeError(content: string): VDocError | undefined {
  if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) {
    return { code: "too-large" };
  }
  return undefined;
}

function fail(error: VDocError): { ok: false; error: VDocError } {
  return { ok: false, error };
}

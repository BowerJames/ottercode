/**
 * The vdoc domain of the IPC contract: virtual design documents that
 * live only in the main process's memory — never on disk. These leaf
 * types are shared with the VDocStore (the authority) so the store's
 * interface and the wire payloads are one definition, never two.
 * Channel constants live in channels.ts (declared once, shared by
 * both sides); per-channel request/result payloads live below; the
 * typed-client entries live in client.ts, as with every domain.
 *
 * Wire payloads are these shapes, never store-internal maps.
 */

/**
 * A doc's identity. A flat namespace: a lowercase slug ending in
 * `.md` (letters, digits, hyphens; starts alphanumeric; ≤64 chars) —
 * deliberately NOT a filesystem path, so no consumer can mistake a
 * doc for a file the built-in tools could touch. Validation lives in
 * the store — the one choke point every adapter inherits.
 */
export type VDocName = string;

/** Who performed a mutation. Flows through to change events so the
 * renderer can suppress echoes of its own writes and badge the
 * agent's. The store records it; it does not act on it. */
export type VDocOrigin = "user" | "agent";

/**
 * Failure modes of vdoc operations. Codes in the payload, not thrown
 * — the house pattern: IPC mangles throws, and consumers discriminate
 * outcomes. Prose is NOT the store's business; the agent tool layer
 * turns codes into model-facing text (including the name rule and
 * surviving docs), and the renderer maps codes to UI.
 */
export type VDocErrorCode =
  /** Malformed name (see VDocName's rule). */
  | "invalid-name"
  /** No doc under that name. */
  | "not-found"
  /** create on an existing name. */
  | "exists"
  /** write against a version that is no longer current — someone
   * wrote in between the caller's read and write. The store is
   * unchanged; re-read and retry. */
  | "conflict"
  /** Content exceeds the size cap (policy; see VDocStore). */
  | "too-large";

export type VDocError = { code: VDocErrorCode };

/** A doc's identity-and-revision pair — list's element, mutation
 * results' payload. Version is a counter, not a history: it counts
 * successful mutations (create establishes 1) and guards writes;
 * old content is gone the moment a write lands. */
export type VDocMeta = { name: VDocName; version: number };

/** What a read returns: the doc's whole content and the version it
 * is at — the version a subsequent write must name. */
export type VDocContent = { content: string; version: number };

/**
 * One successful mutation, in full — the change-event shape the store
 * emits and the wire pushes. Upserts carry whole content (docs are
 * small; the renderer stays dumb — no patch algebra crosses any
 * boundary). Deletes carry only the name: the content is gone.
 */
export type VDocChange =
  | {
      kind: "created" | "written";
      name: VDocName;
      content: string;
      version: number;
      origin: VDocOrigin;
    }
  | { kind: "deleted"; name: VDocName };

/* ── Wire payloads ─────────────────────────────────────────────────────
 *
 * Per-channel request and result types. Result arms inline their
 * payloads (house style — see fs.ts), and the error arm is the
 * store's union verbatim: the vdoc authority is total and
 * in-memory, so there is no `unknown` arm (fs needs one because the
 * OS is unpredictable; both vdoc wire ends ship in one bundle, so
 * there is no version skew to defend against either).
 *
 * `origin` never crosses the wire: the renderer IS the user (glue
 * hardcodes "user"), and the agent writes through its in-process
 * tool (hardcodes "agent"). Provenance is decided at each adapter,
 * below the wire — no caller can forge it.
 */

export type VDocFail = { ok: false; error: VDocError };

/** Cannot fail (the authority is total over an empty request) —
 *  the same stance as fs's RootResult. */
export type VDocListResult = { docs: readonly VDocMeta[] };

/** Request for VDOC_CREATE_CHANNEL. Content from birth — there is
 *  no empty genesis state to create (see the store). */
export type VDocCreateRequest = { name: VDocName; content: string };
export type VDocCreateResult = { ok: true; doc: VDocMeta } | VDocFail;

/** Request for VDOC_READ_CHANNEL. */
export type VDocReadRequest = { name: VDocName };
export type VDocReadResult =
  | { ok: true; content: string; version: number }
  | VDocFail;

/** Request for VDOC_UPDATE_CHANNEL. `expectedVersion` must be the
 *  version the caller's content is based on; anything else is
 *  `conflict` with the doc untouched. */
export type VDocUpdateRequest = {
  name: VDocName;
  content: string;
  expectedVersion: number;
};
export type VDocUpdateResult = { ok: true; doc: VDocMeta } | VDocFail;

/** Request for VDOC_DELETE_CHANNEL — user-initiated only; the agent
 *  toolset deliberately exposes no delete. */
export type VDocDeleteRequest = { name: VDocName };
export type VDocDeleteResult = { ok: true } | VDocFail;

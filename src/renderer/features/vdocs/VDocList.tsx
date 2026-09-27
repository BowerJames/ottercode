import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { vdocKey } from "../editor/store";
import { useEditor } from "../editor/use-editor";
import { useVdocs } from "./use-vdocs";

/**
 * The sidebar's Design section: which virtual design docs exist, plus
 * the create/open/delete affordances. Rows are names + versions — the
 * list never holds content (see the vdocs store). Opening hands off to
 * the editor's public openVdoc — the one cross-feature touch, store to
 * store, same seam the file tree's selection uses.
 *
 * Docs appear here the moment either writer creates them — the user
 * via the + flow, the agent via its vdoc_write tool (the push feeds
 * the list). The editor is never yanked: an agent-created doc waits
 * here until you click it.
 */
export function VDocList() {
  const docs = useVdocs((s) => s.docs);
  const create = useVdocs((s) => s.create);
  const remove = useVdocs((s) => s.remove);
  const openVdoc = useEditor((s) => s.openVdoc);
  const activePath = useEditor((s) => s.activePath);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const adderRef = useRef<HTMLInputElement | null>(null);

  // Focus the adder when it opens — programmatic and intentional (the
  // a11y rule dislikes the autoFocus attribute; a ref effect is the
  // sanctioned form for "this input is why the UI changed").
  useEffect(() => {
    if (adding) adderRef.current?.focus();
  }, [adding]);

  const closeAdder = () => {
    setAdding(false);
    setDraft("");
    setError(null);
  };

  const submit = async () => {
    const name = draft.trim();
    if (name.length === 0) {
      closeAdder();
      return;
    }
    const result = await create(name);
    if (result.ok) {
      closeAdder();
      void openVdoc(result.doc.name);
    } else {
      setError(errorText(result.error.code));
    }
  };

  const onAdderKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeAdder();
    }
  };

  return (
    <section className="vdoc-list" aria-label="Design docs">
      <div className="sidebar-header">
        <span className="sidebar-header-name">Design</span>
        <button
          type="button"
          className="sidebar-refresh"
          title="new design doc — shared with the agent, live in memory, never on disk"
          onClick={() => setAdding(true)}
        >
          +
        </button>
      </div>
      {adding && (
        <div className="vdoc-adder">
          <input
            ref={adderRef}
            className="vdoc-adder-input"
            value={draft}
            placeholder="auth-flow.md"
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={onAdderKey}
            onBlur={closeAdder}
          />
          {error !== null && <div className="vdoc-adder-error">{error}</div>}
        </div>
      )}
      {docs.length === 0 && !adding && (
        <div
          className="sidebar-empty"
          title="shared with the agent — never written to disk"
        >
          no design docs yet
        </div>
      )}
      {docs.map((meta) => (
        <div className="vdoc-row" key={meta.name}>
          <button
            type="button"
            className="vdoc-open"
            data-active={activePath === vdocKey(meta.name)}
            title="open this design doc"
            onClick={() => void openVdoc(meta.name)}
          >
            <span className="tree-name">{meta.name}</span>
            <span className="vdoc-version">v{meta.version}</span>
          </button>
          <button
            type="button"
            className="vdoc-delete"
            title="delete this design doc"
            onClick={() => void remove(meta.name)}
          >
            ×
          </button>
        </div>
      ))}
    </section>
  );
}

/** The create error surface: presentation only, mapped per code. */
function errorText(code: string): string {
  switch (code) {
    case "invalid-name":
      return "names are lowercase slugs ending in .md";
    case "exists":
      return "a design doc with that name exists";
    case "too-large":
      return "too large";
    default:
      return "couldn't create it";
  }
}

import { client } from "../../ipc";
import { createEditorStore } from "./store";

/**
 * The feature's composition root: the one place the real client
 * singleton is joined to the store factory. Components import this;
 * store.ts stays pure and testable.
 *
 * The vdoc push wiring lives here too: agent writes (and the echo of
 * this user's own saves) reach OPEN buffers through syncVdoc — the
 * editor's half of the collaboration. The vdocs list feature
 * subscribes to the same broadcast separately for its own projection;
 * neither side knows about the other.
 */
export const useEditor = createEditorStore(client.fs, client.vdoc);

void client.vdoc.onChange((change) => {
  useEditor.getState().syncVdoc(change);
});

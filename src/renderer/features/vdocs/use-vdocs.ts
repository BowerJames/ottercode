import { client } from "../../ipc";
import { createVdocsStore } from "./store";

/**
 * The feature's composition root: the one place the real client
 * singleton is joined to the store factory (same pattern as the
 * editor's use-editor). Components import this; store.ts stays pure
 * and testable.
 *
 * The push wiring lives here too — the store is the projection; this
 * is where the broadcast joins it. The initial pull fills the list
 * before any push can arrive.
 */
export const useVdocs = createVdocsStore(client.vdoc);

void client.vdoc.onChange((change) => {
  useVdocs.getState().applyChange(change);
});
void useVdocs.getState().refresh();

import { afterEach, describe, expect, it } from "vitest";
import { useCollaborationStore, type CollaborationParticipant } from "./collaborationStore";
const participant: CollaborationParticipant = { clientId: "remote", userId: "user", displayName: null, cursor: { x: 1, y: 2 }, selectedIds: ["note"] };
afterEach(() => useCollaborationStore.getState().clear());
describe("ephemeral collaboration session", () => {
  it("clears other-board participants when the local connection identity changes", () => {
    const store = useCollaborationStore.getState();
    store.setSession({ clientId: "first-board", status: "connected" });
    store.setParticipants([participant]);
    store.setSession({ clientId: "second-board", status: "connecting" });
    expect(useCollaborationStore.getState().participants).toEqual([]);
  });
  it("keeps a connection's participant snapshot through reconnect and clears it on session exit", () => {
    const store = useCollaborationStore.getState();
    store.setSession({ clientId: "local", status: "connected" });
    store.setParticipants([participant]);
    store.setSession({ clientId: "local", status: "reconnecting" });
    expect(useCollaborationStore.getState().participants).toEqual([participant]);
    store.clear();
    expect(useCollaborationStore.getState()).toMatchObject({ clientId: null, status: "disconnected", participants: [] });
  });
});

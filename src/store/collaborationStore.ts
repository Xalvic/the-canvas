import { create } from "zustand";
import type { Point } from "../canvas/viewport/viewportMath";

export type CollaborationStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";
export type CollaborationParticipant = {
  clientId: string;
  userId: string;
  displayName: string | null;
  cursor: Point | null;
  selectedIds: string[];
};
type CollaborationState = {
  clientId: string | null;
  status: CollaborationStatus;
  participants: CollaborationParticipant[];
  setSession: (session: { clientId: string | null; status: CollaborationStatus }) => void;
  setParticipants: (participants: CollaborationParticipant[]) => void;
  clear: () => void;
};

export const useCollaborationStore = create<CollaborationState>((set) => ({
  clientId: null,
  status: "disconnected",
  participants: [],
  setSession: (session) => set((state) => ({
    ...session,
    participants: session.clientId !== state.clientId || session.status === "disconnected" ? [] : state.participants,
  })),
  setParticipants: (participants) => set({ participants }),
  clear: () => set({ clientId: null, status: "disconnected", participants: [] }),
}));

import type { BoardSaveStatus } from "../store/boardStore";
import { BOARD_TAB_READ_ONLY_MESSAGE } from "../persistence/boardTabCoordinator";
import type { BoardTabOwnership } from "../persistence/boardTabCoordinator";

type StatusInput = {
  local: BoardSaveStatus; cloud: string; account: boolean; role: string | null;
  tabReadOnly: boolean; pendingImages: number; recovery: boolean;
  tabOwnership?: BoardTabOwnership;
  localError?: string | null;
};

/** Presentation only: no second persisted save state. Durability outranks routine progress. */
export function savePresentation(input: StatusInput) {
  const { local, cloud, account, role, tabReadOnly, pendingImages, recovery } = input;
  const cloudFailed = account && ["error", "conflict", "signed-out"].includes(cloud);
  if (input.tabOwnership === "acquiring" || local === "loading") return { label: "Opening device draft…", attention: false };
  if (input.tabOwnership === "unverified") return { label: "Editing access needs checking", attention: true };
  if (input.tabOwnership === "unavailable") return { label: "Couldn’t save on this device", attention: true };
  if (input.tabOwnership === "passive") return { label: "Shared device drawing", attention: false };
  if (!account && input.tabOwnership === "contended") return { label: "Waiting for the other tab to finish", attention: true };
  if (local === "error" && (!tabReadOnly || (input.localError && input.localError !== BOARD_TAB_READ_ONLY_MESSAGE))) return {
    label: cloudFailed ? "Your changes haven’t been saved" : "Couldn’t save on this device", attention: true,
  };
  if (tabReadOnly) return { label: "Editing in another tab", attention: true };
  if (account && role === "none") return { label: "Access removed", attention: true };
  if (cloud === "conflict") return { label: "This board changed elsewhere", attention: true };
  if (cloud === "signed-out") return { label: "Sign in to sync this board", attention: true };
  if (cloud === "error") return { label: local === "saved" ? "Account save failed · saved on this device" : "Account save failed", attention: true };
  if (account && role === "viewer") return { label: "Can view · account board", attention: recovery };
  if (account && pendingImages > 0) return { label: `${pendingImages} ${pendingImages === 1 ? "image" : "images"} waiting to upload`, attention: true };
  if (local === "saving") return { label: "Saving on this device…", attention: false };
  if (!account) return { label: "Saved on this device", attention: recovery };
  if (cloud === "saving") return { label: "Saving to account…", attention: false };
  if (cloud === "unsaved" || cloud === "local") return { label: "Changes waiting to save", attention: false };
  return { label: "Saved to account", attention: recovery };
}

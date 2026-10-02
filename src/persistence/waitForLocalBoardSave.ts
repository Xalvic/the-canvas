import { useBoardStore } from "../store/boardStore";

// Auth navigation must wait for the existing IndexedDB autosave, not start a
// competing write. Its status becomes saved only for the latest queued revision.
export function waitForLocalBoardSave(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {};
    let timer: ReturnType<typeof setTimeout>;
    function finish(error?: Error) {
      unsubscribe(); clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    }
    function abort() { finish(new Error("Sign-in cancelled")); }
    function check() {
      const board = useBoardStore.getState();
      if (board.saveStatus === "error") finish(new Error("Could not save your canvas"));
      else if (board.isHydrated && board.saveStatus === "saved") finish();
    }
    if (signal.aborted) { reject(new Error("Sign-in cancelled")); return; }
    unsubscribe = useBoardStore.subscribe(check);
    signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => finish(new Error("Local save timed out")), 10000);
    check();
  });
}

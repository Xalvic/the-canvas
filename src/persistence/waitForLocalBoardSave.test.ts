import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBoardStore } from "../store/boardStore";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";

const initial = useBoardStore.getState();
beforeEach(() => useBoardStore.setState({ isHydrated: true, saveStatus: "saved", saveError: null }));
afterEach(() => { useBoardStore.setState(initial); vi.useRealTimers(); });
describe("save before Google navigation", () => {
  it("waits for the existing autosave to finish without issuing a separate write", async () => {
    useBoardStore.getState().markSaving();
    let ready = false;
    const pending = waitForLocalBoardSave(new AbortController().signal).then(() => { ready = true; });
    await Promise.resolve(); expect(ready).toBe(false);
    useBoardStore.getState().markSaved(1000); await pending; expect(ready).toBe(true);
  });
  it("accepts an already saved board but blocks failed saves", async () => {
    await waitForLocalBoardSave(new AbortController().signal);
    useBoardStore.getState().markSaveError("quota failure");
    await expect(waitForLocalBoardSave(new AbortController().signal)).rejects.toThrow("Could not save");
  });
  it("aborts waiting when the account UI unmounts", async () => {
    useBoardStore.getState().markSaving();
    const controller = new AbortController(); const pending = waitForLocalBoardSave(controller.signal);
    controller.abort(); await expect(pending).rejects.toThrow("cancelled");
  });
  it("times out rather than navigating with an unfinished local save", async () => {
    vi.useFakeTimers(); useBoardStore.getState().markSaving();
    const checked = expect(waitForLocalBoardSave(new AbortController().signal)).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(10000); await checked;
  });
});

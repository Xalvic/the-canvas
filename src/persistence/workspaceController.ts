import { useEffect, useState, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { getAccount, signOut, type AccountState } from "../api/auth";
import { BoardApiError, BoardSignInRequired, createServerPage, getServerBoard } from "../api/boards";
import { AccountBoardQueries, accountBoardKeys } from "../api/accountBoardQueries";
import { getServerWorkspace, initializeServerWorkspace, updateServerWorkspace } from "../api/workspace";
import { useBoardStore } from "../store/boardStore";
import { useInteractionStore } from "../store/interactionStore";
import { COMMIT_CANVAS_INTERACTIONS_EVENT } from "../canvas/viewport/pointerInteractionEvents";
import { flushLocalBoardSave, captureLocalBoard } from "./useLocalBoardPersistence";
import { waitForLocalBoardSave } from "./waitForLocalBoardSave";
import type { AccountBoardSession } from "./accountBoardSession";
import { invitationIntent } from "../components/ServerBoards/invitationIntent";
import { GuestTransfer, type GuestTransferSummary } from "./guestTransfer";
import { loadLocalBoard } from "./localBoardStorage";
import {
  pageFromUrl, pendingPageIntent, clearPageIntent, writePageUrl,
  workspaceInitializationIntent, clearWorkspaceInitializationIntent,
  newPageIntent, rememberNewPage, clearNewPageIntent,
} from "./workspaceNavigation";

export type WorkspaceState = {
  status: "auth-loading" | "guest" | "workspace" | "service-error" | "expired" | "signing-out";
  account: AccountState | null;
  phase: "loading" | "ready" | "empty" | "transfer-pending" | "error" | "device";
  error: string | null;
  transfer?: GuestTransferSummary | null;
  transferProgress?: string | null;
  creatingPage?: boolean;
  creationError?: string | null;
};
export type WorkspaceEntryIntent = { pendingTransfer: boolean };

// Commit the established pointer/text boundary before journaling or changing users.
// Native composition blocks a switch until compositionend; it is never discarded.
export class WorkspaceController {
  private state: WorkspaceState = { status: "auth-loading", account: null, phase: "loading", error: null };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private preferenceRequest: AbortController | null = null;
  private preferenceQueue: Promise<void> = Promise.resolve();
  private generation = 0;
  private accountEpoch = 0;
  private navigating = false;
  private composing = false;
  private stopped = true;
  private queries: AccountBoardQueries;
  constructor(private session: AccountBoardSession, private client: QueryClient,
    // M7 supplies deliberate, account-bound transfer intent here. Mere auth never imports.
    private entryIntent: () => WorkspaceEntryIntent = () => ({ pendingTransfer: false }),
    private transfer: GuestTransfer | null = null) {
    this.queries = new AccountBoardQueries(client);
  }
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private userId() { return this.state.account?.status === "signed-in" ? this.state.account.user.id : null; }
  private current(generation: number) { return !this.stopped && generation === this.generation; }
  private begin() {
    this.request?.abort();
    this.update({ creatingPage: false });
    this.navigating = false;
    useBoardStore.setState({ navigationPending: false });
    const controller = new AbortController();
    this.request = controller;
    return { controller, generation: ++this.generation };
  }
  private prepare = async (signal: AbortSignal) => {
    // The existing save waiter allows a passive guest to return immediately.
    // Initial hydration must still finish before any account page can replace it.
    if (!useBoardStore.getState().isHydrated) await new Promise<void>((resolve, reject) => {
      const stop = useBoardStore.subscribe((board) => { if (board.isHydrated) finish(); });
      const finish = (error?: unknown) => { stop(); signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(); };
      const abort = () => finish(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      else if (useBoardStore.getState().isHydrated) finish();
    });
    signal.throwIfAborted();
    if (this.composing) throw new Error("Finish entering text before switching pages.");
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.dispatchEvent(new Event(COMMIT_CANVAS_INTERACTIONS_EVENT));
    if (useInteractionStore.getState().mode !== "idle") throw new Error("Finish the current canvas interaction before switching pages.");
    await flushLocalBoardSave();
    await waitForLocalBoardSave(signal);
    signal.throwIfAborted();
  };
  private async guest(signal: AbortSignal) {
    // setUser can already be returning to guest after an interrupted operation.
    while (this.session.getState().busy) {
      await new Promise<void>((resolve, reject) => {
        const stop = this.session.subscribe(() => { if (!this.session.getState().busy) finish(); });
        const finish = (error?: unknown) => { stop(); signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(); };
        const abort = () => finish(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
        else if (!this.session.getState().busy) finish();
      });
      signal.throwIfAborted();
    }
    if (useBoardStore.getState().account && !await this.session.back()) throw new Error(this.session.getState().error ?? "Couldn’t open your device drawing. Its draft is preserved.");
  }

  start() {
    this.stopped = false;
    const composing = () => { this.composing = true; };
    const composed = () => { this.composing = false; };
    const pop = () => { if (this.userId()) void this.enter("replace", true); };
    const focus = () => { if (!this.request && this.state.status !== "signing-out") void this.checkAccount(); };
    window.addEventListener("popstate", pop);
    window.addEventListener("focus", focus);
    window.addEventListener("online", focus);
    document.addEventListener("compositionstart", composing);
    document.addEventListener("compositionend", composed);
    const stopBoard = useBoardStore.subscribe((board, previous) => {
      if (this.navigating || this.stopped || !board.isHydrated || board.sessionVersion === previous.sessionVersion) return;
      if (this.session.getState().userId !== this.userId()) return;
      if (board.account?.ownerId === this.userId() && this.userId()) this.opened(board.account.boardId, "push");
      else if (!board.account && this.userId() && previous.account?.ownerId === this.userId()) { writePageUrl(null, "push"); this.update({ phase: "device" }); }
    });
    const stopSession = this.session.subscribe(() => {
      if (this.userId() && !this.session.getState().userId && this.state.status !== "signing-out") void this.expired();
    });
    this.session.onPageDeleted = async () => { await this.enter("replace", false, true); };
    void this.checkAccount();
    return () => {
      this.stopped = true; this.generation++; this.accountEpoch++; this.request?.abort(); this.preferenceRequest?.abort();
      useBoardStore.setState({ navigationPending: false });
      this.session.onPageDeleted = null;
      stopBoard(); stopSession();
      window.removeEventListener("popstate", pop); window.removeEventListener("focus", focus); window.removeEventListener("online", focus);
      document.removeEventListener("compositionstart", composing); document.removeEventListener("compositionend", composed);
    };
  }

  checkAccount = async () => {
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(new Error("Account check timed out. Try again.")), 20_000);
    if (!this.state.account) this.update({ status: "auth-loading", error: null });
    try {
      const account = await getAccount(controller.signal);
      if (!this.current(generation) || controller.signal.aborted) return;
      const oldUser = this.userId();
      if (oldUser && (account.status !== "signed-in" || oldUser !== account.user.id)) await this.transfer?.pause();
      await this.transfer?.authentication(account.status === "signed-in" ? account.user.id : null, controller.signal);
      if (!this.current(generation) || controller.signal.aborted) return;
      this.transferState();
      if (account.status === "guest") {
        if (oldUser) { await this.expired(account); return; }
        if (useBoardStore.getState().account) {
          await this.prepare(controller.signal);
          this.session.setUser(null);
          await this.guest(controller.signal);
        }
        this.update({ account, status: "guest", phase: "device", error: null, creationError: null });
        return;
      }
      if (oldUser === account.user.id && this.session.getState().userId === oldUser) {
        this.update({ account, status: "workspace", error: null });
        return; // Another device's last-opened preference never drives this editor.
      }
      this.accountEpoch++; this.preferenceRequest?.abort();
      this.update({ account, status: "workspace", phase: "loading", error: null, creationError: null });
      useBoardStore.setState({ navigationPending: true });
      await this.prepare(controller.signal);
      if (!this.current(generation)) return;
      this.session.setUser(account.user.id);
      if (useBoardStore.getState().account?.ownerId !== account.user.id) await this.guest(controller.signal);
      if (this.current(generation)) await this.enter("replace");
    } catch (error) {
      if (this.current(generation)) this.update({ status: "service-error", error: this.errorMessage(error) });
    } finally {
      clearTimeout(timeout);
      if (this.request === controller) this.request = null;
      if (this.current(generation)) useBoardStore.setState({ navigationPending: false });
    }
  };

  private errorMessage(error: unknown) { return error instanceof Error ? error.message : "Couldn’t open your workspace. Try again."; }
  private opened(pageId: string, mode: "push" | "replace") {
    writePageUrl(pageId, mode);
    clearPageIntent();
    this.update({ status: "workspace", phase: "ready", error: null });
    const userId = this.userId(), epoch = this.accountEpoch;
    const sameAccount = () => !this.stopped && epoch === this.accountEpoch && this.userId() === userId && this.session.getState().userId === userId;
    // Serialize preferences so an older slow PATCH cannot overwrite the latest open.
    this.preferenceQueue = this.preferenceQueue.then(async () => {
      if (!userId || !sameAccount() || useBoardStore.getState().account?.boardId !== pageId) return;
      const request = new AbortController(); this.preferenceRequest = request;
      const timeout = setTimeout(() => request.abort(), 10_000);
      try { await updateServerWorkspace({ lastOpenedBoardId: pageId }, request.signal); }
      catch (error) {
        if (sameAccount()) {
          if (error instanceof BoardSignInRequired) void this.expired();
          else if (useBoardStore.getState().account?.boardId === pageId) this.update({ error: "Your page is open, but its return location wasn’t saved. Retry workspace." });
        }
      } finally { clearTimeout(timeout); if (this.preferenceRequest === request) this.preferenceRequest = null; }
    });
  }

  openPage = async (pageId: string) => {
    await this.enter("push", false, false, pageId);
    return this.state.phase === "ready" && useBoardStore.getState().account?.boardId === pageId;
  };
  newPage = async () => {
    const userId = this.userId();
    if (!userId || this.request || this.session.getState().busy || this.state.status !== "workspace") return false;
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(new Error("New page request timed out. Retry the same page.")), 20_000);
    this.navigating = true; useBoardStore.setState({ navigationPending: true });
    this.update({ creatingPage: true, creationError: null });
    try {
      await this.prepare(controller.signal);
      const intent = newPageIntent(userId);
      let id = intent.destinationId;
      if (!id) {
        const { destinationId: _destination, ...payload } = intent;
        const result = await createServerPage(payload, controller.signal, userId);
        if (!this.current(generation) || controller.signal.aborted || this.userId() !== userId) return false;
        id = result.board.id;
        rememberNewPage(userId, intent, id);
        await this.client.invalidateQueries({ queryKey: accountBoardKeys.list(userId), exact: true });
      }
      const metadata = await getServerBoard(id, controller.signal, userId);
      if (!this.current(generation) || this.userId() !== userId) return false;
      if (!await this.session.open(metadata, controller.signal, false, undefined, userId)) throw this.session.getFailure() ?? new Error(this.session.getState().error ?? "Couldn’t open the new page.");
      if (!this.current(generation) || controller.signal.aborted || this.userId() !== userId) return false;
      clearNewPageIntent(userId);
      this.opened(id, "push");
      return true;
    } catch (error) {
      if (this.current(generation)) {
        if (error instanceof BoardSignInRequired) await this.expired();
        else this.update({ creationError: `${this.errorMessage(error)} Your current drawing is preserved. Retry new page to continue the same request.` });
      }
      return false;
    } finally {
      clearTimeout(timeout);
      if (this.current(generation)) { this.navigating = false; this.update({ creatingPage: false }); useBoardStore.setState({ navigationPending: false }); }
      if (this.request === controller) this.request = null;
    }
  };
  // Legacy session callers can return locally; workspace chrome has no device chooser.
  openDevice = async () => {
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    this.navigating = true; useBoardStore.setState({ navigationPending: true });
    try {
      await this.prepare(controller.signal);
      if (!await this.session.back(controller.signal) || !this.current(generation)) return false;
      writePageUrl(null, "push"); this.update({ phase: "device", error: null }); return true;
    } catch (error) { if (this.current(generation)) this.update({ error: this.errorMessage(error) }); return false; }
    finally {
      clearTimeout(timeout);
      if (this.current(generation)) { this.navigating = false; useBoardStore.setState({ navigationPending: false }); }
      if (this.request === controller) this.request = null;
    }
  };
  enter = async (mode: "push" | "replace" = "replace", fromHistory = false, afterDeletion = false, requestedPageId?: string) => {
    const userId = this.userId();
    if (!userId) return;
    const previousPage = useBoardStore.getState().account?.ownerId === userId ? useBoardStore.getState().account?.boardId : null;
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(new Error("Workspace request timed out. Try again.")), this.transfer?.intent?.status === "active" ? 10 * 60_000 : 20_000);
    this.navigating = true;
    useBoardStore.setState({ navigationPending: true });
    this.update({ status: "workspace", phase: "loading", error: null });
    try {
      await this.prepare(controller.signal);
      const workspace = await getServerWorkspace(controller.signal);
      if (!this.current(generation) || controller.signal.aborted) return;
      // Read the list after state: another tab can initialize between these reads.
      // An earlier UI list request must not supply its pre-initialization snapshot.
      await this.client.cancelQueries({ queryKey: accountBoardKeys.list(userId), exact: true });
      const boards = await this.queries.list(userId, controller.signal);
      if (!this.current(generation) || controller.signal.aborted) return;
      const transferPending = this.entryIntent().pendingTransfer || !!this.transfer?.intent && ["active", "committed"].includes(this.transfer.intent.status) && this.transfer.intent.accountId === userId;
      let candidate: string | null = null;
      if (!workspace.initialized) {
        const intent = workspaceInitializationIntent(userId, !transferPending);
        const initialized = await initializeServerWorkspace(intent, controller.signal);
        if (!this.current(generation) || controller.signal.aborted) return;
        clearWorkspaceInitializationIntent(userId);
        candidate = initialized.board?.id ?? null;
        this.client.setQueryData(accountBoardKeys.list(userId), initialized.board
          ? [...boards.filter((board) => board.id !== initialized.board!.id), initialized.board] : boards);
        void this.client.invalidateQueries({ queryKey: accountBoardKeys.list(userId), exact: true });
      } else clearWorkspaceInitializationIntent(userId);
      const explicit = afterDeletion ? null : requestedPageId ?? pageFromUrl() ?? (fromHistory ? null : pendingPageIntent());
      // Invitation UI retains its own acceptance choice. M7's transfer stays pending
      // whenever a deliberate page/invitation has priority.
      if (transferPending && !explicit && !invitationIntent()) {
        this.update({ phase: "transfer-pending" });
        if (this.transfer?.intent) await this.finishTransfer(userId, controller.signal, generation, mode);
        return;
      }
      // A reload of this tab's incomplete destination must not expose an editable
      // blank page that the eventual import would change underneath the user.
      if (this.transfer?.intent?.status === "active" && explicit === this.transfer.intent.destinationId) {
        this.update({ phase: "transfer-pending" }); return;
      }
      const fallback = workspace.lastOpenedBoardId ?? candidate ?? [...boards].sort((a, b) =>
        Number(a.role !== "owner" && a.role !== undefined) - Number(b.role !== "owner" && b.role !== undefined) ||
        (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.id.localeCompare(b.id))[0]?.id ?? null;
      let target: string | null = explicit ?? fallback;
      let missingExplicit = false;
      const attempted = new Set<string>();
      while (target) {
        attempted.add(target);
        try {
          const metadata = await getServerBoard(target, controller.signal);
          if (!this.current(generation) || controller.signal.aborted) return;
          const opened = await this.session.open(metadata, controller.signal,
            useBoardStore.getState().accessRole !== (metadata.role ?? "owner"));
          if (!this.current(generation) || controller.signal.aborted) return;
          if (!opened) throw this.session.getFailure() ?? new Error(this.session.getState().error ?? "Couldn’t open this page. Try again.");
          this.opened(target, mode);
          if (missingExplicit) this.update({ error: "That page is unavailable. Opened an accessible page." });
          return;
        } catch (error) {
          if (error instanceof BoardApiError && error.code === "BOARD_NOT_FOUND") {
            missingExplicit = true;
            target = boards.find((board) => !attempted.has(board.id))?.id ?? null;
          } else throw error;
        }
      }
      writePageUrl(null, "replace"); clearPageIntent();
      this.update({ phase: "empty", error: missingExplicit ? "That page is unavailable." : null });
    } catch (error) {
      if (this.current(generation)) {
        if (error instanceof BoardSignInRequired || !this.session.getState().userId) { await this.expired(); return; }
        if (fromHistory && previousPage) writePageUrl(previousPage, "replace");
        this.update({ phase: afterDeletion ? "error" : previousPage ? "ready" : "error", error: this.errorMessage(error) });
      }
    } finally {
      clearTimeout(timeout);
      if (this.current(generation)) { this.navigating = false; useBoardStore.setState({ navigationPending: false }); }
      if (this.request === controller) this.request = null;
    }
  };

  retry = async () => {
    if (this.userId() && this.state.status !== "service-error") await this.enter();
    else await this.checkAccount();
  };
  private transferState() {
    const intent = this.transfer?.intent;
    this.update({ transfer: intent && intent.status !== "complete" ? { id: intent.id, status: intent.status, destinationId: intent.destinationId } : null });
  }
  // The same explicit consent flow is used before OAuth and later in Account.
  prepareGoogleSignIn = async (bringDrawing: boolean, signal: AbortSignal) => {
    await this.prepare(signal);
    if (!this.transfer) return "/api/auth/google";
    await this.transfer.declineAuthentication();
    if (!bringDrawing) return "/api/auth/google";
    if (!this.state.account?.guestTransferEnabled) throw new Error("Bringing drawings is unavailable right now. Your drawing stays on this device.");
    const source = useBoardStore.getState().account ? await loadLocalBoard() : captureLocalBoard();
    signal.throwIfAborted();
    if (!source) throw new Error("Your device drawing could not be read. It remains on this device.");
    const flowId = await this.transfer.stage(source, null, signal);
    return `/api/auth/google?clientFlow=${encodeURIComponent(flowId)}`;
  };
  bringGuestDrawing = async () => {
    const userId = this.userId();
    if (!userId || !this.transfer) return;
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      await this.prepare(controller.signal);
      if (!this.state.account?.guestTransferEnabled) throw new Error("Bringing drawings is unavailable right now. Your drawing stays on this device.");
      const source = await loadLocalBoard();
      controller.signal.throwIfAborted();
      if (!source) throw new Error("Your device drawing could not be read.");
      if (this.transfer.intent && this.transfer.intent.status !== "complete") throw new Error("Resume the existing drawing transfer first.");
      await this.transfer.stage(source, userId, controller.signal);
      this.transferState();
    } catch (error) { if (this.current(generation)) this.update({ error: this.errorMessage(error) }); }
    finally { clearTimeout(timeout); if (this.request === controller) this.request = null; }
    if (this.current(generation) && this.transfer.intent?.status === "active") await this.resumeTransfer();
  };
  private async finishTransfer(userId: string, signal: AbortSignal, generation: number, mode: "push" | "replace") {
    if (!this.transfer) return;
    this.update({ transferProgress: "Preparing your drawing…" });
    try {
      if (!this.state.account?.guestTransferEnabled) throw new Error("Bringing drawings is unavailable right now. Your drawing stays on this device.");
      const destinationId = await this.transfer.resume(userId, signal, (transferProgress) => {
        if (this.current(generation)) this.update({ transferProgress });
      });
      if (!this.current(generation) || signal.aborted || this.userId() !== userId) return;
      this.transferState();
      const metadata = await getServerBoard(destinationId, signal, userId);
      if (!await this.session.open(metadata, signal, true, this.transfer.intent?.source.viewport, userId))
        throw this.session.getFailure() ?? new Error("The drawing is transferred. Retry to open its page.");
      if (this.current(generation) && !signal.aborted) {
        await this.client.invalidateQueries({ queryKey: accountBoardKeys.list(userId), exact: true });
        if (!this.current(generation) || signal.aborted) return;
        await this.transfer.opened(); this.transferState();
        if (!this.current(generation) || signal.aborted) return;
        this.opened(destinationId, mode);
      }
    } catch (error) {
      if (this.current(generation)) {
        if (error instanceof BoardSignInRequired) { await this.expired(); return; }
        if (error instanceof BoardApiError && error.code === "ACCOUNT_CHANGED") {
          await this.transfer.pause(); this.transferState(); await this.checkAccount(); return;
        }
        this.transferState();
        this.update({ phase: "transfer-pending", error: this.errorMessage(error) });
      }
    } finally { if (this.current(generation)) this.update({ transferProgress: null }); }
  }
  resumeTransfer = async () => {
    const userId = this.userId();
    if (!userId || !this.transfer?.intent || this.request) return;
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(new Error("Drawing transfer timed out. Retry to continue from the same page.")), 10 * 60_000);
    this.navigating = true; useBoardStore.setState({ navigationPending: true });
    this.update({ phase: "transfer-pending", error: null });
    try {
      await this.prepare(controller.signal);
      await this.transfer.activate(userId);
      this.transferState();
      await this.finishTransfer(userId, controller.signal, generation, "push");
    } catch (error) { if (this.current(generation)) this.update({ error: this.errorMessage(error) }); }
    finally {
      clearTimeout(timeout);
      if (this.request === controller) this.request = null;
      if (this.current(generation)) { this.navigating = false; useBoardStore.setState({ navigationPending: false }); }
    }
  };
  pauseTransfer = async () => {
    this.request?.abort();
    await this.transfer?.pause(); this.transferState();
    await this.enter();
  };
  private expired = async (guestAccount?: AccountState) => {
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    this.navigating = false;
    this.accountEpoch++;
    useBoardStore.setState({ navigationPending: true });
    this.preferenceRequest?.abort();
    this.update({ status: "expired", account: guestAccount ?? null, phase: "loading", creationError: null, error: "Your session ended. Sign in to return to your workspace." });
    try {
      await this.prepare(controller.signal);
      await this.transfer?.pause(); this.transferState();
      this.session.setUser(null);
      await this.guest(controller.signal);
      if (this.current(generation)) { writePageUrl(null, "replace"); this.update({ phase: "device" }); }
    } catch (error) {
      if (this.current(generation)) { this.session.setUser(null); this.update({ error: this.errorMessage(error) }); }
    }
    finally { clearTimeout(timeout); if (this.request === controller) this.request = null; if (this.current(generation)) useBoardStore.setState({ navigationPending: false }); }
  };
  logout = async () => {
    if (this.state.status === "signing-out") return;
    const { controller, generation } = this.begin();
    const timeout = setTimeout(() => controller.abort(new Error("Sign-out timed out. Try again.")), 20_000);
    const account = this.state.account;
    let signedOut = false;
    this.update({ status: "signing-out", error: null, creationError: null });
    useBoardStore.setState({ navigationPending: true });
    try {
      await this.prepare(controller.signal);
      await signOut(controller.signal);
      if (!this.current(generation) || controller.signal.aborted) return;
      signedOut = true;
      await this.transfer?.pause(); this.update({ transfer: null });
      this.accountEpoch++;
      this.preferenceRequest?.abort(); this.navigating = false;
      this.update({ account: { status: "guest", googleSignInEnabled: true, guestTransferEnabled: account?.guestTransferEnabled }, phase: "loading" });
      this.session.setUser(null);
      await this.guest(controller.signal);
      if (this.current(generation)) { writePageUrl(null, "replace"); clearPageIntent(); this.update({ status: "guest", phase: "device" }); }
    } catch (error) {
      if (this.current(generation)) this.update({ account: signedOut ? { status: "guest", googleSignInEnabled: true } : account,
        status: signedOut ? "guest" : "service-error", error: this.errorMessage(error) });
    }
    finally { clearTimeout(timeout); if (this.request === controller) this.request = null; if (this.current(generation)) useBoardStore.setState({ navigationPending: false }); }
  };
}

export function useWorkspaceController(session: AccountBoardSession) {
  const client = useQueryClient();
  const [workspace] = useState(() => new WorkspaceController(session, client, undefined, new GuestTransfer()));
  const state = useSyncExternalStore(workspace.subscribe, workspace.getState);
  useEffect(() => workspace.start(), [workspace]);
  return { workspace, state };
}

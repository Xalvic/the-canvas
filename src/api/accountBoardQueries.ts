import { MutationObserver, QueryClient, queryOptions, type FetchQueryOptions, type QueryKey } from "@tanstack/react-query";
import {
  BoardApiError, createServerBoard, deleteServerBoard, getServerBoardDocument,
  listServerBoards, renameServerBoard, saveServerBoardDocument, type ServerBoard,
} from "./boards";
import type { CanvasDocument } from "../persistence/canvasDocument";
import { applyBoardOperation, type CollaborationOperationInput } from "./collaboration";
import { getBoardSharing, getInvitations } from "./sharing";

export const accountBoardKeys = {
  all: ["account-boards"] as const,
  owner: (ownerId: string) => ["account-boards", ownerId] as const,
  list: (ownerId: string) => ["account-boards", ownerId, "list"] as const,
  invitations: (ownerId: string) => ["account-boards", ownerId, "invitations"] as const,
  sharing: (ownerId: string, boardId: string) => ["account-boards", ownerId, "sharing", boardId] as const,
  document: (ownerId: string, boardId: string) => ["account-boards", ownerId, "document", boardId] as const,
};

export function retryBoardRead(failureCount: number, error: Error) {
  return failureCount < 1 && (error instanceof TypeError ||
    (error instanceof BoardApiError && error.status >= 500));
}

export const ACCOUNT_METADATA_INTERVAL = 30_000;
const metadataReadOptions = {
  staleTime: ACCOUNT_METADATA_INTERVAL,
  gcTime: 5 * 60_000,
  retry: retryBoardRead,
  retryDelay: 500,
  // Fail promptly offline; reconnect refreshes reads but never replays writes.
  networkMode: "always" as const,
  refetchOnReconnect: "always" as const,
  refetchOnWindowFocus: true,
  refetchOnMount: true,
  refetchIntervalInBackground: false,
};

export function accountBoardListOptions(ownerId: string) {
  return queryOptions({
    ...metadataReadOptions,
    queryKey: accountBoardKeys.list(ownerId),
    queryFn: ({ signal }) => listServerBoards(signal, ownerId),
  });
}

export function accountInvitationListOptions(ownerId: string) {
  return queryOptions({
    ...metadataReadOptions,
    queryKey: accountBoardKeys.invitations(ownerId),
    queryFn: ({ signal }) => getInvitations(signal, ownerId),
  });
}

export function accountBoardSharingOptions(ownerId: string, boardId: string) {
  return queryOptions({
    ...metadataReadOptions,
    queryKey: accountBoardKeys.sharing(ownerId, boardId),
    queryFn: ({ signal }) => getBoardSharing(boardId, signal, ownerId),
  });
}

/** Refresh metadata after access changes without fetching/replacing editor documents. */
export function invalidateAccountMetadata(client: QueryClient, ownerId: string) {
  return client.invalidateQueries({
    queryKey: accountBoardKeys.owner(ownerId),
    predicate: (query) => ["list", "invitations", "sharing"].includes(String(query.queryKey[2])),
  });
}

/** Server snapshots only. The editor and durable recovery drafts remain outside this cache. */
export class AccountBoardQueries {
  constructor(private client: QueryClient) {}

  clear() {
    void this.client.cancelQueries({ queryKey: accountBoardKeys.all });
    this.client.removeQueries({ queryKey: accountBoardKeys.all });
    for (const mutation of this.client.getMutationCache().findAll({ mutationKey: accountBoardKeys.all })) {
      this.client.getMutationCache().remove(mutation);
    }
  }

  private async read<T, TKey extends QueryKey>(options: FetchQueryOptions<T, Error, T, TKey>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const abort = () => { void this.client.cancelQueries({ queryKey: options.queryKey, exact: true }); };
    signal.addEventListener("abort", abort, { once: true });
    try { return await this.client.fetchQuery(options); }
    finally { signal.removeEventListener("abort", abort); }
  }

  document(ownerId: string, boardId: string, signal: AbortSignal) {
    const options = queryOptions({
      queryKey: accountBoardKeys.document(ownerId, boardId),
      queryFn: ({ signal: querySignal }) => getServerBoardDocument(boardId, querySignal, ownerId),
      // Always check the revision before opening, reloading, or reconciling an uncertain save.
      staleTime: 0,
      retry: false,
      networkMode: "always",
    });
    return this.read(options, signal);
  }

  list(ownerId: string, signal: AbortSignal) {
    const options = accountBoardListOptions(ownerId);
    return this.read({ ...options, staleTime: 0, retry: false }, signal);
  }

  private async mutate<T>(ownerId: string, action: string, signal: AbortSignal, request: () => Promise<T>, accepted: (data: T) => Promise<void>) {
    const observer = new MutationObserver<T, Error, void>(this.client, {
      mutationKey: [...accountBoardKeys.owner(ownerId), "mutation", action],
      mutationFn: () => { signal.throwIfAborted(); return request(); },
      retry: false,
      networkMode: "always",
      gcTime: 0,
      onSuccess: async (data) => { if (!signal.aborted) await accepted(data); },
    });
    try { return await observer.mutate(); }
    finally { observer.reset(); }
  }

  private async updateList(ownerId: string, signal: AbortSignal, update: (boards: ServerBoard[]) => ServerBoard[]) {
    const queryKey = accountBoardKeys.list(ownerId);
    await this.client.cancelQueries({ queryKey, exact: true });
    if (signal.aborted) return;
    this.client.setQueryData<ServerBoard[]>(queryKey, (boards) => boards ? update(boards) : undefined);
    void this.client.invalidateQueries({ queryKey, exact: true });
  }

  create(ownerId: string, title: string, signal: AbortSignal) {
    return this.mutate(ownerId, "create", signal, () => createServerBoard(title, signal),
      (board) => this.updateList(ownerId, signal, (boards) => [board, ...boards.filter((item) => item.id !== board.id)]));
  }

  rename(ownerId: string, boardId: string, title: string, signal: AbortSignal) {
    return this.mutate(ownerId, "rename", signal, () => renameServerBoard(boardId, title, signal, ownerId),
      (board) => this.updateList(ownerId, signal, (boards) => boards.map((item) => item.id === board.id ? board : item)));
  }

  save(ownerId: string, boardId: string, document: CanvasDocument, revision: number, signal: AbortSignal) {
    return this.mutate(ownerId, "save", signal, () => saveServerBoardDocument(boardId, document, revision, signal, ownerId), async (saved) => {
      const queryKey = accountBoardKeys.document(ownerId, boardId);
      await this.client.cancelQueries({ queryKey, exact: true });
      if (signal.aborted) return;
      this.client.setQueryData(queryKey, saved);
      await this.updateList(ownerId, signal, (boards) => boards.map((item) => item.id === boardId ? { ...item, updatedAt: saved.updatedAt } : item));
    });
  }

  operation(ownerId: string, boardId: string, input: CollaborationOperationInput, signal: AbortSignal) {
    return this.mutate(ownerId, "operation", signal, () => applyBoardOperation(boardId, input, signal, ownerId), async (saved) => {
      const queryKey = accountBoardKeys.document(ownerId, boardId);
      await this.client.cancelQueries({ queryKey, exact: true });
      if (signal.aborted) return;
      this.client.setQueryData(queryKey, saved);
      await this.updateList(ownerId, signal, (boards) => boards.map((item) => item.id === boardId ? { ...item, updatedAt: saved.updatedAt } : item));
    });
  }

  remove(ownerId: string, boardId: string, signal: AbortSignal) {
    return this.mutate(ownerId, "delete", signal, () => deleteServerBoard(boardId, signal), async () => {
      const queryKey = accountBoardKeys.document(ownerId, boardId);
      await this.client.cancelQueries({ queryKey, exact: true });
      if (signal.aborted) return;
      this.client.removeQueries({ queryKey, exact: true });
      await this.updateList(ownerId, signal, (boards) => boards.filter((item) => item.id !== boardId));
    });
  }
}

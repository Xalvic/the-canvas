import { z } from "zod";
import { BoardTabCoordinator, boardTabCoordinator } from "./boardTabCoordinator";
import { EDITOR_JOURNAL_STORE_NAME, openCanvasDatabase, requestResult } from "./database";
import { accountBoardStorageId, parseLocalBoard, type LocalBoardRecord } from "./localBoardStorage";
import { serializeDocumentSnapshot } from "./canvasDocumentAdapters";

export type EditorJournal = {
  id: string; journalVersion: 1; editorId: string; board: LocalBoardRecord;
  legacySource?: string;
};
const prefix = (id: string) => `${id}:editor:`;

export function parseEditorJournal(value: unknown): EditorJournal | null {
  if (!value || typeof value !== "object") return null;
  const journal = value as EditorJournal, board = parseLocalBoard(journal.board);
  if (journal.journalVersion !== 1 || !z.uuid().safeParse(journal.editorId).success || !board?.account || typeof journal.id !== "string") return null;
  const base = accountBoardStorageId(board.account.ownerId, board.account.boardId);
  const suffix = journal.id.endsWith(":recovery") ? journal.id.slice(0, -9) : journal.id;
  if (!suffix.startsWith(prefix(base)) || !z.uuid().safeParse(suffix.slice(prefix(base).length)).success ||
      board.id !== (journal.id.endsWith(":recovery") ? `${base}:recovery` : base) ||
      (journal.legacySource !== undefined && typeof journal.legacySource !== "string")) return null;
  return { ...journal, board };
}

export function journalIsDirty(board: LocalBoardRecord) {
  const link = board.account;
  if (!link) return false;
  if (link.pendingOperation || link.pendingSave || link.pendingTitle || board.title !== link.savedTitle) return true;
  try {
    return JSON.stringify(serializeDocumentSnapshot(board.objects, { boardId: link.boardId, imageAssets: link.imageAssets })) !== JSON.stringify(link.savedDocument);
  } catch { return true; }
}

/** A document lifetime always gets a fresh editor identity, including duplicated
 * tabs. An inactive journal may be adopted only under its own atomic lease. */
export class AccountEditorJournals {
  readonly editorId = crypto.randomUUID();
  private active = new Map<string, string>();
  constructor(private coordinator: BoardTabCoordinator = boardTabCoordinator, private database = openCanvasDatabase) {}
  leaseId(id: string) { return this.active.get(id) ?? id; }
  async list(id: string): Promise<EditorJournal[]> {
    const database = await this.database();
    const values = await requestResult(database.transaction(EDITOR_JOURNAL_STORE_NAME).objectStore(EDITOR_JOURNAL_STORE_NAME).getAll(IDBKeyRange.bound(prefix(id), `${prefix(id)}\uffff`)));
    const journals: EditorJournal[] = [];
    for (const value of values) {
      // Invalid records for this board must not be silently overwritten.
      if (typeof value?.id !== "string" || !value.id.startsWith(prefix(id)) || value.id.endsWith(":recovery")) continue;
      const journal = parseEditorJournal(value);
      if (!journal) throw new Error("An editor draft has an unsupported format. Its stored data was preserved.");
      journals.push(journal);
    }
    return journals.sort((a, b) => Number(journalIsDirty(b.board)) - Number(journalIsDirty(a.board)) || a.id.localeCompare(b.id));
  }
  async read(id: string): Promise<LocalBoardRecord | null> {
    const key = this.active.get(id);
    if (!key) return null;
    const database = await this.database();
    const value = await requestResult(database.transaction(EDITOR_JOURNAL_STORE_NAME).objectStore(EDITOR_JOURNAL_STORE_NAME).get(key));
    if (value === undefined) return null;
    const journal = parseEditorJournal(value);
    if (!journal || journal.board.id !== id) throw new Error("The editor draft has an unsupported identity or format");
    return journal.board;
  }
  async open(id: string, legacy: () => Promise<LocalBoardRecord | null>): Promise<LocalBoardRecord | null> {
    const current = this.active.get(id);
    if (current && await this.coordinator.acquire(current)) return this.read(id);
    this.active.delete(id);
    const journals = await this.list(id);
    // Check legacy work even when journals already exist: an old writer may
    // have released its draft only after the first journal was created.
    if (await this.coordinator.acquire(id)) {
      try {
        const board = await legacy();
        if (board) {
          const source = JSON.stringify({ title: board.title, objects: board.objects, account: board.account });
          if (!journals.some((journal) => journal.legacySource === source) && (!journals.length || journalIsDirty(board))) {
            const key = `${prefix(id)}${crypto.randomUUID()}`;
            if (!await this.coordinator.acquire(key)) throw new Error("Could not reserve this editor's device draft");
            await this.coordinator.writeJournal(key, [{ id: key, journalVersion: 1, editorId: this.editorId, board, legacySource: source }]);
            this.active.set(id, key);
            return board;
          }
        }
      } finally { await this.coordinator.release(id); }
    }
    for (const journal of journals) {
      if (await this.coordinator.acquire(journal.id)) {
        this.active.set(id, journal.id);
        return this.read(id);
      }
    }
    const key = `${prefix(id)}${crypto.randomUUID()}`;
    if (!await this.coordinator.acquire(key)) throw new Error("Could not reserve this editor's device draft");
    this.active.set(id, key);
    return null;
  }
  async save(board: LocalBoardRecord) {
    const link = board.account;
    if (!link) throw new Error("Account editor draft requires an account");
    const base = accountBoardStorageId(link.ownerId, link.boardId), key = this.active.get(base);
    if (!key) throw new Error("Open this account page before saving its editor draft");
    if (board.id !== base && board.id !== `${base}:recovery`) throw new Error("Editor draft identity mismatch");
    const database = await this.database();
    const previous = await requestResult(database.transaction(EDITOR_JOURNAL_STORE_NAME).objectStore(EDITOR_JOURNAL_STORE_NAME).get(key));
    const journal: EditorJournal = {
      id: board.id.endsWith(":recovery") ? `${key}:recovery` : key,
      journalVersion: 1, editorId: this.editorId, board,
      ...(previous?.legacySource ? { legacySource: previous.legacySource } : {}),
    };
    await this.coordinator.writeJournal(key, [journal]);
  }
  async recovery(id: string): Promise<LocalBoardRecord | null> {
    const key = this.active.get(id);
    if (!key) return null;
    const database = await this.database();
    const value = await requestResult(database.transaction(EDITOR_JOURNAL_STORE_NAME).objectStore(EDITOR_JOURNAL_STORE_NAME).get(`${key}:recovery`));
    if (value === undefined) return null;
    const journal = parseEditorJournal(value);
    if (!journal || journal.board.id !== `${id}:recovery`) throw new Error("The editor recovery draft has an unsupported format");
    return journal.board;
  }
  select(id: string, key: string) { this.active.set(id, key); }
  async reserve(id: string, key: string) {
    const journal = (await this.list(id)).find((item) => item.id === key);
    if (!journal || !await this.coordinator.acquire(key)) throw new Error("That draft is currently being edited in another tab");
    const database = await this.database();
    const value = await requestResult(database.transaction(EDITOR_JOURNAL_STORE_NAME).objectStore(EDITOR_JOURNAL_STORE_NAME).get(key));
    const latest = parseEditorJournal(value);
    if (!latest || latest.board.id !== id) throw new Error("That draft could not be safely loaded");
    return latest.board;
  }
}

export const accountEditorJournals = new AccountEditorJournals();
export const activeBoardLeaseId = (id: string) => accountEditorJournals.leaseId(id);

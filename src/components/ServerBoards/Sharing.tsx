import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountBoardKeys, accountInvitationListOptions, accountBoardSharingOptions, invalidateAccountMetadata } from "../../api/accountBoardQueries";
import { BoardSignInRequired } from "../../api/boards";
import { acceptInvitation, cancelInvitation, changeMemberRole, declineInvitation, removeMember, type MemberRole } from "../../api/sharing";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";
import { Dialog } from "../Dialog";
import { getServerBoard } from "../../api/boards";
import { clearInvitationIntent, invitationIntent } from "./invitationIntent";
import { useVisiblePolling } from "./useVisiblePolling";

function useSharingAction(userId: string, session: AccountBoardSession) {
  const client = useQueryClient();
  const request = useRef<AbortController | null>(null);
  const dispatching = useRef(false);
  useEffect(() => () => request.current?.abort(), [userId]);
  const mutation = useMutation({
    mutationKey: [...accountBoardKeys.owner(userId), "sharing-mutation"], retry: false, networkMode: "always", gcTime: 0,
    mutationFn: async (action: (signal: AbortSignal) => Promise<unknown>) => {
      const controller = new AbortController(); request.current = controller;
      const timeout = setTimeout(() => controller.abort(), 20000);
      try { return await action(controller.signal); }
      finally { clearTimeout(timeout); if (request.current === controller) request.current = null; }
    },
    onSuccess: () => {
      if (session.getState().userId === userId) void invalidateAccountMetadata(client, userId);
    },
    onError: (error) => {
      if (session.getState().userId === userId && error instanceof BoardSignInRequired) session.expire();
      else if (session.getState().userId === userId) void invalidateAccountMetadata(client, userId);
    },
  });
  return { ...mutation, mutate: (work: (signal: AbortSignal) => Promise<unknown>) => {
    if (dispatching.current) return;
    dispatching.current = true;
    mutation.mutate(work, { onSettled: () => { dispatching.current = false; } });
  } };
}

export function InvitationInbox({ userId, session, opened, navigate }: { userId: string; session: AccountBoardSession; opened?: () => void; navigate?: (id: string) => Promise<boolean> }) {
  const invitations = useQuery(accountInvitationListOptions(userId));
  const action = useSharingAction(userId, session);
  const [accepted, setAccepted] = useState<{ boardId: string; title: string } | null>(null);
  useEffect(() => { if (invitations.error instanceof BoardSignInRequired) session.expire(); }, [invitations.error, session]);
  const linked = invitationIntent();
  return <section className="board-sharing" aria-label="Invitations">
    <strong>Invitations</strong>
    {invitations.isPending && <p role="status">Loading invitations…</p>}
    {invitations.isError && <p role="alert">{invitations.data ? "Couldn’t update invitations. Showing the last loaded list." : "Couldn’t load invitations."} <button type="button" disabled={invitations.isFetching} onClick={() => void invitations.refetch({ cancelRefetch: false })}>Retry invitations</button></p>}
    {invitations.data?.length === 0 && <p>{linked ? "No pending invitation for this Google account. Check the invited email; the invitation may have expired or been accepted." : "No pending invitations."}</p>}
    {linked && invitations.data && invitations.data.length > 0 && !invitations.data.some((invite) => invite.id === linked) && <p role="status">This link has no pending invitation for this Google account. Check the invited email; it may have expired, been cancelled or already accepted.</p>}
    {linked && <p>Use the invited Google account. Acceptance is your choice; signing in does not accept or open a board.</p>}
    {invitations.data?.map((invite) => <div key={invite.id} className="sharing-person" data-linked={linked === invite.id}>
      <strong>{invite.boardTitle}</strong><span>{invite.ownerEmail} · {invite.role === "editor" ? "Can edit" : "Can view"}</span>
      <span>Expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
      <div className="server-board-actions">
        <button type="button" className="primary-action" disabled={action.isPending} onClick={() => action.mutate(async (signal) => { await acceptInvitation(invite.id, signal); if (session.getState().userId === userId) { clearInvitationIntent(invite.id); setAccepted({ boardId: invite.boardId, title: invite.boardTitle }); } })}>Accept invitation</button>
        <button type="button" disabled={action.isPending} onClick={() => action.mutate(async (signal) => { await declineInvitation(invite.id, signal); clearInvitationIntent(invite.id); })}>Decline</button>
      </div>
    </div>)}
    {accepted && <div className="invitation-ready"><p role="status">Invitation accepted for {accepted.title}.</p><button type="button" disabled={action.isPending || session.getState().busy} onClick={() => action.mutate(async (signal) => {
      const result = navigate ? await navigate(accepted.boardId) : await session.open(await getServerBoard(accepted.boardId, signal));
      if (result && !session.getState().error) opened?.();
    })}>Open page</button></div>}
    {action.isSuccess && !accepted && <p role="status">Invitation updated.</p>}
    {action.isError && <p role="alert">{action.error.message}</p>}
  </section>;
}

export function BoardAccess({ userId, boardId, title, session }: { userId: string; boardId: string; title: string; session: AccountBoardSession }) {
  const visiblePolling = useVisiblePolling();
  const sharing = useQuery({ ...accountBoardSharingOptions(userId, boardId), refetchInterval: visiblePolling });
  const action = useSharingAction(userId, session);
  const [copyStatus, setCopyStatus] = useState("");
  const [remove, setRemove] = useState<{ userId: string; email: string } | null>(null);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState("");
  useEffect(() => { if (sharing.error instanceof BoardSignInRequired) session.expire(); }, [sharing.error, session]);
  const copyLink = async (id: string) => {
    const url = new URL(import.meta.env.BASE_URL, window.location.origin); url.searchParams.set("invite", id);
    try { await navigator.clipboard.writeText(url.href); setCopyStatus("Invitation link copied. Send it to the invited person."); }
    catch { setManualLink(url.href); setCopyStatus("Clipboard unavailable. Select and copy the invitation link below."); }
  };
  return <><section className="board-sharing" aria-label={`Existing access to ${title}`}>
    {sharing.isPending && <p role="status">Loading sharing…</p>}
    {sharing.isError && <p role="alert">{sharing.data ? "Couldn’t update sharing. Showing the last loaded list." : "Couldn’t load sharing."} <button type="button" disabled={sharing.isFetching} onClick={() => void sharing.refetch({ cancelRefetch: false })}>Retry sharing</button></p>}
    {sharing.data && <>
      <strong>Members</strong>
      {sharing.data.members.length === 0 && <p>No invited members yet.</p>}
      {sharing.data.members.map((member) => <div key={member.userId} className="sharing-person">
        <span>{member.displayName ?? member.email} · {member.email}</span>
        <div className="server-board-actions">
          <select aria-label={`Role for ${member.email}`} value={member.role} disabled={action.isPending} onChange={(event) => {
            const nextRole = event.target.value as MemberRole;
            setPendingRow(member.userId);
            action.mutate((signal) => changeMemberRole(boardId, member.userId, nextRole, signal));
          }}>
            <option value="viewer">Can view</option><option value="editor">Can edit</option>
          </select>
          <button type="button" disabled={action.isPending} onClick={() => setRemove(member)}>Remove access</button>
        </div>
        {action.isPending && pendingRow === member.userId && <span role="status">Updating this person…</span>}
      </div>)}
      <strong>Pending invitations</strong>
      {sharing.data.invitations.length === 0 && <p>No pending invitations.</p>}
      {sharing.data.invitations.map((invite) => <div key={invite.id} className="sharing-person">
        <span>{invite.email} · {invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
        <div className="server-board-actions">
          <button type="button" onClick={() => void copyLink(invite.id)}>Copy invitation link</button>
          <button type="button" disabled={action.isPending} onClick={() => { setPendingRow(invite.id); action.mutate((signal) => cancelInvitation(boardId, invite.id, signal)); }}>Cancel invitation</button>
        </div>
        {action.isPending && pendingRow === invite.id && <span role="status">Cancelling this invitation…</span>}
      </div>)}
    </>}
    {action.isPending && <p role="status">Updating sharing…</p>}
    {action.isSuccess && <p role="status">Sharing updated.</p>}
    {action.isError && <p role="alert">{action.error.message}</p>}
    {copyStatus && <p role="status">{copyStatus}</p>}
    {manualLink && <label className="dialog-field">Invitation link<input readOnly value={manualLink} onFocus={(event) => event.currentTarget.select()} /></label>}
  </section>
  <Dialog open={!!remove} title="Remove board access" close={() => setRemove(null)}>
    <p>Remove invited access for {remove?.email}? Their device drafts remain. An active shared link can still grant access again.</p>
    <div className="dialog-actions"><button type="button" className="danger-action" disabled={action.isPending} onClick={() => { if (!remove) return; setPendingRow(remove.userId); action.mutate(async (signal) => { await removeMember(boardId, remove.userId, signal); setRemove(null); }); }}>Confirm removal</button><button type="button" onClick={() => setRemove(null)}>Cancel</button></div>
    {action.isError && <p role="alert">{action.error.message}</p>}
  </Dialog>
  </>;
}

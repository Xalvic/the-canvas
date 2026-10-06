import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountBoardKeys, retryBoardRead } from "../../api/accountBoardQueries";
import { BoardSignInRequired } from "../../api/boards";
import { acceptInvitation, cancelInvitation, changeMemberRole, declineInvitation, getBoardSharing, getInvitations, inviteToBoard, removeMember, type MemberRole } from "../../api/sharing";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";
import { Dialog } from "../Dialog";
import { getServerBoard } from "../../api/boards";
import { clearInvitationIntent, invitationIntent } from "./invitationIntent";

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
      if (session.getState().userId === userId) void client.invalidateQueries({ queryKey: accountBoardKeys.owner(userId) });
    },
    onError: (error) => {
      if (session.getState().userId === userId && error instanceof BoardSignInRequired) session.expire();
      else if (session.getState().userId === userId) void client.invalidateQueries({ queryKey: accountBoardKeys.owner(userId) });
    },
  });
  return { ...mutation, mutate: (work: (signal: AbortSignal) => Promise<unknown>) => {
    if (dispatching.current) return;
    dispatching.current = true;
    mutation.mutate(work, { onSettled: () => { dispatching.current = false; } });
  } };
}

export function InvitationInbox({ userId, session, opened }: { userId: string; session: AccountBoardSession; opened?: () => void }) {
  const invitations = useQuery({ queryKey: [...accountBoardKeys.owner(userId), "invitations"], queryFn: ({ signal }) => getInvitations(signal), retry: retryBoardRead, networkMode: "always", refetchInterval: 30000 });
  const action = useSharingAction(userId, session);
  const [accepted, setAccepted] = useState<{ boardId: string; title: string } | null>(null);
  useEffect(() => { if (invitations.error instanceof BoardSignInRequired) session.expire(); }, [invitations.error, session]);
  const linked = invitationIntent();
  return <section className="board-sharing" aria-label="Invitations">
    <strong>Invitations</strong>
    {invitations.isPending && <p role="status">Loading invitations…</p>}
    {invitations.isError && <p role="alert">Couldn’t load invitations. <button type="button" onClick={() => void invitations.refetch()}>Retry invitations</button></p>}
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
      const board = await getServerBoard(accepted.boardId, signal);
      await session.open(board);
      if (!session.getState().error) opened?.();
    })}>Open board</button></div>}
    {action.isSuccess && !accepted && <p role="status">Invitation updated.</p>}
    {action.isError && <p role="alert">{action.error.message}</p>}
    <button type="button" disabled={invitations.isFetching} onClick={() => void invitations.refetch()}>Refresh invitations</button>
  </section>;
}

export function BoardSharing({ userId, boardId, title, session, close }: { userId: string; boardId: string; title: string; session: AccountBoardSession; close: () => void }) {
  const sharing = useQuery({ queryKey: [...accountBoardKeys.owner(userId), "sharing", boardId], queryFn: ({ signal }) => getBoardSharing(boardId, signal), retry: retryBoardRead, networkMode: "always", refetchInterval: 30000 });
  const action = useSharingAction(userId, session);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MemberRole>("viewer");
  const [copyStatus, setCopyStatus] = useState("");
  const [created, setCreated] = useState<{ id: string; email: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [remove, setRemove] = useState<{ userId: string; email: string } | null>(null);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [manualLink, setManualLink] = useState("");
  useEffect(() => { if (sharing.error instanceof BoardSignInRequired) session.expire(); }, [sharing.error, session]);
  const copyLink = async (id: string) => {
    const url = new URL(import.meta.env.BASE_URL, window.location.origin); url.searchParams.set("invite", id);
    try { await navigator.clipboard.writeText(url.href); setCopyStatus("Invitation link copied. Send it to the invited person."); }
    catch { setManualLink(url.href); setCopyStatus("Clipboard unavailable. Select and copy the invitation link below."); }
  };
  return <Dialog open title={`Share ${title}`} close={close}>
  <section className="board-sharing" aria-label={`Sharing ${title}`}>
    <p>Invite a Google account to this board. Only the owner manages access.</p>
    <form onSubmit={(event) => { event.preventDefault(); if (uncertain) return; setPendingRow("create"); action.mutate(async (signal) => {
      try { const result = await inviteToBoard(boardId, email, role, signal); setCreated(result.invitation); setEmail(""); setManualLink(""); }
      catch (error) { setUncertain(true); throw error; }
    }); }}>
      <label>Google email<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Invite role<select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}><option value="viewer">Can view</option><option value="editor">Can edit</option></select></label>
      <button className="primary-action" type="submit" disabled={action.isPending || !sharing.data || uncertain}>{action.isPending && pendingRow === "create" ? "Creating…" : "Create invitation"}</button>
    </form>
    {created && <div className="invitation-ready"><strong>Invitation ready for {created.email}</strong><button type="button" onClick={() => void copyLink(created.id)}>Copy invitation link</button></div>}
    <p className="dialog-footnote">Send the link yourself. No email is sent. Only the invited Google account can accept it; expires in 7 days. Can edit includes renaming; Can view permits viewing only.</p>
    {uncertain && <p role="status">The request may have reached your account. Refresh sharing to check the pending invitations before creating another.</p>}
    <button type="button" disabled={sharing.isFetching || action.isPending} onClick={async () => { const result = await sharing.refetch(); if (!result.isError) setUncertain(false); }}>Refresh sharing</button>
    {sharing.isPending && <p role="status">Loading sharing…</p>}
    {sharing.isError && <p role="alert">Couldn’t load sharing. <button type="button" onClick={() => void sharing.refetch()}>Retry sharing</button></p>}
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
          {created?.id !== invite.id && <button type="button" onClick={() => void copyLink(invite.id)}>Copy invitation link</button>}
          <button type="button" disabled={action.isPending} onClick={() => { setPendingRow(invite.id); action.mutate(async (signal) => { await cancelInvitation(boardId, invite.id, signal); if (created?.id === invite.id) setCreated(null); }); }}>Cancel invitation</button>
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
    <p>Remove access for {remove?.email}? Their device drafts remain; they will lose access to this account board.</p>
    <div className="dialog-actions"><button type="button" className="danger-action" disabled={action.isPending} onClick={() => { if (!remove) return; setPendingRow(remove.userId); action.mutate(async (signal) => { await removeMember(boardId, remove.userId, signal); setRemove(null); }); }}>Confirm removal</button><button type="button" onClick={() => setRemove(null)}>Cancel</button></div>
    {action.isError && <p role="alert">{action.error.message}</p>}
  </Dialog>
  </Dialog>;
}

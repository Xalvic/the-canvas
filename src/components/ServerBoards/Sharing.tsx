import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountBoardKeys, retryBoardRead } from "../../api/accountBoardQueries";
import { BoardSignInRequired } from "../../api/boards";
import { acceptInvitation, cancelInvitation, changeMemberRole, declineInvitation, getBoardSharing, getInvitations, inviteToBoard, removeMember, type MemberRole } from "../../api/sharing";
import type { AccountBoardSession } from "../../persistence/accountBoardSession";

function useSharingAction(userId: string, session: AccountBoardSession) {
  const client = useQueryClient();
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), [userId]);
  return useMutation({
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
    },
  });
}

export function InvitationInbox({ userId, session }: { userId: string; session: AccountBoardSession }) {
  const invitations = useQuery({ queryKey: [...accountBoardKeys.owner(userId), "invitations"], queryFn: ({ signal }) => getInvitations(signal), retry: retryBoardRead, networkMode: "always", refetchInterval: 30000 });
  const action = useSharingAction(userId, session);
  useEffect(() => { if (invitations.error instanceof BoardSignInRequired) session.expire(); }, [invitations.error, session]);
  const linked = new URLSearchParams(window.location.search).get("invite");
  return <section className="board-sharing" aria-label="Invitations">
    <strong>Invitations</strong>
    {invitations.isPending && <p role="status">Loading invitations…</p>}
    {invitations.isError && <p role="alert">Couldn’t load invitations. <button type="button" onClick={() => void invitations.refetch()}>Retry invitations</button></p>}
    {invitations.data?.length === 0 && <p>{linked ? "No pending invitation for this Google account. Check the invited email; the invitation may have expired or been accepted." : "No pending invitations."}</p>}
    {invitations.data?.map((invite) => <div key={invite.id} className="sharing-person">
      <strong>{invite.boardTitle}</strong><span>{invite.ownerEmail} · {invite.role}</span>
      <span>Expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
      <div className="server-board-actions">
        <button type="button" disabled={action.isPending} onClick={() => action.mutate((signal) => acceptInvitation(invite.id, signal))}>Accept invitation</button>
        <button type="button" disabled={action.isPending} onClick={() => action.mutate((signal) => declineInvitation(invite.id, signal))}>Decline</button>
      </div>
    </div>)}
    {action.isSuccess && <p role="status">Invitation updated. Accepted boards appear in your board list.</p>}
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
  useEffect(() => { if (sharing.error instanceof BoardSignInRequired) session.expire(); }, [sharing.error, session]);
  const copyLink = async (id: string) => {
    const url = new URL(import.meta.env.BASE_URL, window.location.origin); url.searchParams.set("invite", id);
    try { await navigator.clipboard.writeText(url.href); setCopyStatus("Invitation link copied. Send it to the invited person."); }
    catch { setCopyStatus(`Copy this invitation link: ${url.href}`); }
  };
  return <section className="board-sharing" aria-label={`Sharing ${title}`}>
    <div className="server-board-actions"><strong>Share {title}</strong><button type="button" onClick={close}>Close sharing</button></div>
    <p>You are the owner. Editors can edit and rename; viewers can only view. Only you can manage sharing or delete this board.</p>
    <form onSubmit={(event) => { event.preventDefault(); action.mutate((signal) => inviteToBoard(boardId, email, role, signal)); }}>
      <label>Google email<input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Invite role<select value={role} onChange={(event) => setRole(event.target.value as MemberRole)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>
      <button type="submit" disabled={action.isPending || !sharing.data}>Create invitation</button>
    </form>
    <p>Copy a link below and send it yourself. Invitations expire in 7 days. The recipient must sign in with this email and accept; Scribble does not send an email.</p>
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
            action.mutate((signal) => changeMemberRole(boardId, member.userId, nextRole, signal));
          }}>
            <option value="viewer">Viewer</option><option value="editor">Editor</option>
          </select>
          <button type="button" disabled={action.isPending} onClick={() => { if (window.confirm(`Remove access for ${member.email}?`)) action.mutate((signal) => removeMember(boardId, member.userId, signal)); }}>Remove access</button>
        </div>
      </div>)}
      <strong>Pending invitations</strong>
      {sharing.data.invitations.length === 0 && <p>No pending invitations.</p>}
      {sharing.data.invitations.map((invite) => <div key={invite.id} className="sharing-person">
        <span>{invite.email} · {invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}</span>
        <div className="server-board-actions">
          <button type="button" onClick={() => void copyLink(invite.id)}>Copy invitation link</button>
          <button type="button" disabled={action.isPending} onClick={() => action.mutate((signal) => cancelInvitation(boardId, invite.id, signal))}>Cancel invitation</button>
        </div>
      </div>)}
    </>}
    {action.isPending && <p role="status">Updating sharing…</p>}
    {action.isSuccess && <p role="status">Sharing updated.</p>}
    {action.isError && <p role="alert">{action.error.message}</p>}
    {copyStatus && <p role="status">{copyStatus}</p>}
  </section>;
}

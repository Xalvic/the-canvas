import { z } from "zod";

const userResponse = z.object({ user: z.object({ id: z.uuid(), email: z.email(), displayName: z.string().nullable() }),
  capabilities: z.object({ guestTransfer: z.literal(1), shareLinks: z.number().int().positive().optional() }).optional() });
const guestResponse = z.object({ error: z.object({ code: z.literal("UNAUTHENTICATED"), details: z.object({ googleSignInEnabled: z.boolean(), guestTransferEnabled: z.boolean().optional(), shareLinksEnabled: z.boolean().optional() }) }) });
export type AccountState =
  | { status: "guest"; googleSignInEnabled: boolean; guestTransferEnabled?: boolean; shareLinksEnabled?: boolean }
  | { status: "signed-in"; user: z.output<typeof userResponse>["user"]; guestTransferEnabled?: boolean; shareLinksEnabled?: boolean };

export async function getAccount(signal: AbortSignal): Promise<AccountState> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin", signal });
  if (response.status === 401) {
    return { status: "guest", ...guestResponse.parse(await response.json()).error.details };
  }
  if (!response.ok) throw new Error("Could not check your account");
  const parsed = userResponse.parse(await response.json());
  return { status: "signed-in", user: parsed.user, guestTransferEnabled: parsed.capabilities?.guestTransfer === 1, shareLinksEnabled: parsed.capabilities?.shareLinks === 1 };
}

export async function signOut(signal: AbortSignal) {
  const response = await fetch("/api/auth/logout", {
    method: "POST", credentials: "same-origin", headers: { "X-Scribble-Request": "1" }, signal,
  });
  if (!response.ok) throw new Error("Could not sign out. Try again");
}

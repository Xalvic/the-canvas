import { z } from "zod";

const userResponse = z.object({ user: z.object({ id: z.uuid(), email: z.email(), displayName: z.string().nullable() }) });
const guestResponse = z.object({ error: z.object({ code: z.literal("UNAUTHENTICATED"), details: z.object({ googleSignInEnabled: z.boolean() }) }) });
export type AccountState =
  | { status: "guest"; googleSignInEnabled: boolean }
  | { status: "signed-in"; user: z.output<typeof userResponse>["user"] };

export async function getAccount(signal: AbortSignal): Promise<AccountState> {
  const response = await fetch("/api/auth/me", { credentials: "same-origin", signal });
  if (response.status === 401) {
    return { status: "guest", googleSignInEnabled: guestResponse.parse(await response.json()).error.details.googleSignInEnabled };
  }
  if (!response.ok) throw new Error("Could not check your account");
  return { status: "signed-in", user: userResponse.parse(await response.json()).user };
}

export async function signOut(signal: AbortSignal) {
  const response = await fetch("/api/auth/logout", {
    method: "POST", credentials: "same-origin", headers: { "X-Scribble-Request": "1" }, signal,
  });
  if (!response.ok) throw new Error("Could not sign out. Try again");
}

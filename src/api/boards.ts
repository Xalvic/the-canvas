import { z } from "zod";

// This view reads metadata only; it does not load a canvas document.
const boardListSchema = z.object({
  boards: z.array(z.object({ id: z.string(), title: z.string() })),
});

export type ServerBoard = z.infer<typeof boardListSchema>["boards"][number];

export class BoardSignInRequired extends Error {}

export async function listServerBoards(signal: AbortSignal): Promise<ServerBoard[]> {
  const response = await fetch("/api/boards", { signal });
  if (response.status === 401) throw new BoardSignInRequired("Sign in to see your server boards");
  if (!response.ok) throw new Error("Could not load server boards");
  return boardListSchema.parse(await response.json()).boards;
}

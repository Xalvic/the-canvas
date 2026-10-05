import { z } from "zod";
import { cloudDocumentSchema } from "./cloudDocument.js";

export const MAX_COLLABORATION_CHANGES = 5_000;
export const MAX_COLLABORATION_REVISION = 2_147_483_647;
const identifier = z.string().min(1).max(256).refine(
  (value) => value.trim().length > 0 && !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value),
  "Invalid object ID",
);
const objectSchema = cloudDocumentSchema.shape.content.shape.objects.element;
export const collaborationOperationSchema = z.strictObject({
  operationId: z.uuid(),
  baseRevision: z.number().int().min(0).max(MAX_COLLABORATION_REVISION),
  changes: z.array(z.strictObject({
    id: identifier,
    before: objectSchema.nullable(),
    after: objectSchema.nullable(),
  })).min(1).max(MAX_COLLABORATION_CHANGES),
}).superRefine((input, context) => {
  const ids = new Set<string>();
  for (const [index, change] of input.changes.entries()) {
    if (ids.has(change.id)) context.addIssue({ code: "custom", path: ["changes", index, "id"], message: "Duplicate changed object ID" });
    ids.add(change.id);
    for (const field of ["before", "after"] as const) {
      if (change[field] && change[field].id !== change.id) context.addIssue({
        code: "custom", path: ["changes", index, field, "id"], message: "Changed object ID must match its operation ID",
      });
    }
    if (change.before === null && change.after === null) context.addIssue({
      code: "custom", path: ["changes", index], message: "A change must contain an object before or after",
    });
  }
});
export type CollaborationOperation = z.output<typeof collaborationOperationSchema>;
export type CollaborationOperationInput = CollaborationOperation;
export type StoredCanvasObject = z.output<typeof objectSchema>;

export const presenceSchema = z.strictObject({
  clientId: z.uuid(),
  cursor: z.strictObject({ x: z.number().finite().min(-1e9).max(1e9), y: z.number().finite().min(-1e9).max(1e9) }).nullable(),
  selectedIds: z.array(identifier).max(100),
});
export type BoardPresence = z.output<typeof presenceSchema>;

import { z } from "zod";
import { canvasDocumentSchema, CANVAS_DOCUMENT_LIMITS } from "./canvasDocument.js";

const finiteNumber = z.number().finite();
const identifier = z.string().min(1).max(CANVAS_DOCUMENT_LIMITS.idLength)
  .refine((value) => value.trim().length > 0 && !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value), "Invalid object ID");

// Cloud documents store an immutable asset identity, never a signed URL or a
// device-local blob identity. Browser adapters remain unchanged until their slice.
export const cloudImageSchema = z.strictObject({
  id: identifier,
  type: z.literal("image"),
  assetId: z.uuid(),
  zIndex: finiteNumber,
  createdAt: finiteNumber.nonnegative(),
  updatedAt: finiteNumber.nonnegative(),
  groupId: identifier.optional(),
  x: finiteNumber,
  y: finiteNumber,
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
  originalWidth: z.number().int().min(1).max(4096),
  originalHeight: z.number().int().min(1).max(4096),
  name: z.string().max(256).refine((value) => !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value), "Invalid image name").optional(),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]).optional(),
});

const objectSchema = z.union([canvasDocumentSchema.shape.content.shape.objects.element, cloudImageSchema]);
export const cloudDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  content: z.strictObject({ objects: z.array(objectSchema).max(CANVAS_DOCUMENT_LIMITS.objects) }),
}).superRefine((document, context) => {
  const objects = document.content.objects;
  const nonImages = objects.flatMap((object, index) => object.type === "image" ? [] : [{ object, index }]);
  // Reuse the established connector/stroke/default validation. Remap indexes
  // so errors still point at the submitted ordered array, including images.
  const checked = canvasDocumentSchema.safeParse({
    schemaVersion: document.schemaVersion,
    content: { objects: nonImages.map(({ object }) => object) },
  });
  if (!checked.success) for (const issue of checked.error.issues) {
    const path = [...issue.path];
    if (path[0] === "content" && path[1] === "objects" && typeof path[2] === "number") {
      path[2] = nonImages[path[2]]?.index ?? path[2];
    }
    context.addIssue({ ...issue, path });
  }
  const ids = new Set<string>();
  for (const [index, object] of objects.entries()) {
    if (ids.has(object.id)) context.addIssue({ code: "custom", path: ["content", "objects", index, "id"], message: "Duplicate object ID" });
    ids.add(object.id);
  }
  const mapOrder = Object.keys(Object.fromEntries(objects.map(({ id }) => [id, true])));
  const changedIndex = objects.findIndex((object, index) => object.id !== mapOrder[index]);
  if (changedIndex !== -1) context.addIssue({ code: "custom", path: ["content", "objects", changedIndex, "id"], message: "Object ID order cannot be preserved by the editor map" });
});

export type CloudCanvasDocument = z.output<typeof cloudDocumentSchema>;
export function documentAssetIds(document: CloudCanvasDocument) {
  return [...new Set(document.content.objects.flatMap((object) => object.type === "image" ? [object.assetId] : []))];
}

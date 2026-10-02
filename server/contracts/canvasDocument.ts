import { z } from "zod";

// Pure document contract shared by the API and browser adapters.

export const CANVAS_DOCUMENT_SCHEMA_VERSION = 1;
export const CANVAS_DOCUMENT_LIMITS = {
  objects: 5_000,
  strokePoints: 100_000,
  idLength: 256,
  textLength: 100_000,
  colorLength: 128,
} as const;

const finiteNumber = z.number().finite();
const jsonString = z.string().refine(
  (value) => !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value),
  "Strings must contain valid Unicode without NUL characters",
);
const identifier = jsonString.min(1).max(CANVAS_DOCUMENT_LIMITS.idLength)
  .refine((value) => value.trim().length > 0, "An ID cannot be blank");
const text = jsonString.max(CANVAS_DOCUMENT_LIMITS.textLength);
const color = jsonString.min(1).max(CANVAS_DOCUMENT_LIMITS.colorLength);
const unitInterval = finiteNumber.min(0).max(1);
const baseFields = {
  id: identifier,
  zIndex: finiteNumber,
  createdAt: finiteNumber.nonnegative(),
  updatedAt: finiteNumber.nonnegative(),
  groupId: identifier.optional(),
};
const spatialFields = {
  ...baseFields,
  x: finiteNumber,
  y: finiteNumber,
  width: finiteNumber.positive(),
  height: finiteNumber.positive(),
};
const endpointSchema = z.strictObject({
  objectId: identifier,
  anchor: z.enum(["top", "right", "bottom", "left"]),
});
const pointSchema = z.strictObject({
  x: finiteNumber,
  y: finiteNumber,
  pressure: unitInterval.optional(),
  widthRatio: finiteNumber.positive().max(1).optional(),
  velocity: finiteNumber.nonnegative().optional(),
});

const canvasObjectSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...spatialFields,
    type: z.literal("card"),
    title: text,
    body: text,
  }),
  z.strictObject({
    ...spatialFields,
    type: z.literal("text"),
    text,
    // These match the renderer's legacy fallbacks, not new-tool preferences.
    color: color.default("#252622"),
    fontSize: finiteNumber.positive().default(17),
    opacity: unitInterval.default(1),
    fontWeight: finiteNumber.min(1).max(1000).default(550),
    textAlign: z.enum(["left", "center", "right"]).default("left"),
  }),
  z.strictObject({
    ...spatialFields,
    type: z.literal("frame"),
    title: text,
    moveContents: z.boolean(),
  }),
  z.strictObject({
    ...spatialFields,
    type: z.literal("stroke"),
    points: z.array(pointSchema).min(1).max(CANVAS_DOCUMENT_LIMITS.strokePoints),
    strokeWidth: finiteNumber.positive(),
    color,
    mode: z.enum(["draw", "solid"]).default("draw"),
    opacity: unitInterval.default(1),
  }),
  z.strictObject({
    ...baseFields,
    type: z.literal("connector"),
    from: endpointSchema,
    to: endpointSchema,
    directed: z.boolean(),
  }),
  // Recognize images solely to return an explicit error, regardless of assets.
  z.looseObject({ type: z.literal("image") }).transform((_image, context) => {
    context.addIssue({
      code: "custom",
      message: "Image-containing documents are unsupported until durable asset storage is implemented",
    });
    return z.NEVER;
  }),
]);

export type StoredCanvasObject = z.output<typeof canvasObjectSchema>;

export const canvasDocumentSchema = z.strictObject({
  schemaVersion: z.literal(CANVAS_DOCUMENT_SCHEMA_VERSION),
  content: z.strictObject({
    objects: z.array(canvasObjectSchema).max(CANVAS_DOCUMENT_LIMITS.objects),
  }),
}).superRefine((document, context) => {
  const objects = document.content.objects;
  const objectsById = new Map<string, StoredCanvasObject>();
  let strokePoints = 0;

  for (const [index, object] of objects.entries()) {
    if (objectsById.has(object.id)) {
      context.addIssue({
        code: "custom",
        path: ["content", "objects", index, "id"],
        message: "Duplicate object ID",
      });
    }
    objectsById.set(object.id, object);
    if (object.type === "stroke") strokePoints += object.points.length;
  }

  if (strokePoints > CANVAS_DOCUMENT_LIMITS.strokePoints) {
    context.addIssue({
      code: "custom",
      path: ["content", "objects"],
      message: `A document cannot exceed ${CANVAS_DOCUMENT_LIMITS.strokePoints} total stroke points`,
    });
  }

  for (const [index, object] of objects.entries()) {
    if (object.type !== "connector") continue;
    for (const end of ["from", "to"] as const) {
      const target = objectsById.get(object[end].objectId);
      if (!target || (target.type !== "card" && target.type !== "text")) {
        context.addIssue({
          code: "custom",
          path: ["content", "objects", index, end, "objectId"],
          message: "A connector endpoint must reference an existing card or text object",
        });
      }
    }
    if (object.from.objectId === object.to.objectId) {
      context.addIssue({
        code: "custom",
        path: ["content", "objects", index, "to", "objectId"],
        message: "A connector must reference two different nodes",
      });
    }
  }

  // Integer-like keys enumerate first in JS records. Reject orders the editor
  // map cannot represent rather than silently reordering an incoming document.
  const mapOrder = Object.keys(Object.fromEntries(objects.map(({ id }) => [id, true])));
  const changedIndex = objects.findIndex((object, index) => object.id !== mapOrder[index]);
  if (changedIndex !== -1) {
    context.addIssue({
      code: "custom",
      path: ["content", "objects", changedIndex, "id"],
      message: "Object ID order cannot be preserved by the editor map",
    });
  }
});

// The pure format excludes the API's board identity, save revision and timestamp.
export type CanvasDocument = z.output<typeof canvasDocumentSchema>;
export type CanvasDocumentContent = CanvasDocument["content"];

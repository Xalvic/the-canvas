import { z } from "zod";
import type { DocumentSnapshot } from "../store/documentStore";
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  canvasDocumentSchema,
  type CanvasDocument,
} from "./canvasDocument";

export type SerializeDocumentOptions = {
  boardId: string;
  imageAssets?: Record<string, string>;
};

export function serializeDocumentSnapshot(
  snapshot: DocumentSnapshot,
  options?: SerializeDocumentOptions,
): CanvasDocument {
  if (
    !snapshot || typeof snapshot !== "object" ||
    (Object.getPrototypeOf(snapshot) !== Object.prototype && Object.getPrototypeOf(snapshot) !== null)
  ) {
    throw new z.ZodError([{ code: "custom", path: [], message: "Expected an editor object map" }]);
  }
  const objects = Object.values(snapshot).map((object, index) => {
    if (!object || object.type !== "image") return object;
    const mappedAsset = options?.imageAssets && Object.hasOwn(options.imageAssets, object.assetId)
      ? options.imageAssets[object.assetId]
      : undefined;
    const sameBoardAsset = options && object.cloudAsset?.boardId === options.boardId
      ? object.cloudAsset.assetId
      : undefined;
    const assetId = mappedAsset ?? sameBoardAsset;
    if (!options || !assetId) {
      throw new z.ZodError([{
        code: "custom",
        path: ["content", "objects", index, "assetId"],
        message: object.cloudAsset
          ? "This image belongs to another board and must be uploaded before saving this account board"
          : "This image must be uploaded before saving this account board",
      }]);
    }
    const { cloudAsset: _provenance, ...wireObject } = object;
    return { ...wireObject, assetId };
  });
  const document = canvasDocumentSchema.parse({
    schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
    content: { objects },
  });
  const keys = Object.keys(snapshot);
  const mismatchedIndex = document.content.objects.findIndex(
    (object, index) => object.id !== keys[index],
  );
  if (mismatchedIndex !== -1) {
    throw new z.ZodError([{
      code: "custom",
      path: ["objects", keys[mismatchedIndex], "id"],
      message: "Snapshot map key must match its object ID",
    }]);
  }
  return document;
}

export function deserializeCanvasDocument(value: unknown, boardId?: string): DocumentSnapshot {
  const document = canvasDocumentSchema.parse(value);
  // fromEntries creates own properties even for IDs such as '__proto__'.
  return Object.fromEntries(document.content.objects.map((object) => [
    object.id,
    object.type === "image" && boardId !== undefined
      ? { ...object, cloudAsset: { boardId, assetId: object.assetId } }
      : object,
  ]));
}

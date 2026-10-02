import { z } from "zod";
import type { DocumentSnapshot } from "../store/documentStore";
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  canvasDocumentSchema,
  type CanvasDocument,
} from "./canvasDocument";

export function serializeDocumentSnapshot(snapshot: DocumentSnapshot): CanvasDocument {
  if (
    !snapshot || typeof snapshot !== "object" ||
    (Object.getPrototypeOf(snapshot) !== Object.prototype && Object.getPrototypeOf(snapshot) !== null)
  ) {
    throw new z.ZodError([{ code: "custom", path: [], message: "Expected an editor object map" }]);
  }
  const document = canvasDocumentSchema.parse({
    schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
    content: { objects: Object.values(snapshot) },
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

export function deserializeCanvasDocument(value: unknown): DocumentSnapshot {
  const document = canvasDocumentSchema.parse(value);
  // fromEntries creates own properties even for IDs such as '__proto__'.
  return Object.fromEntries(document.content.objects.map((object) => [object.id, object]));
}

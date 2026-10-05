export {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  CANVAS_DOCUMENT_LIMITS,
} from "../../server/contracts/canvasDocument.js";
export {
  cloudDocumentSchema as canvasDocumentSchema,
  type CloudCanvasDocument as CanvasDocument,
} from "../../server/contracts/cloudDocument.js";
import type { CloudCanvasDocument } from "../../server/contracts/cloudDocument.js";

export type CanvasDocumentContent = CloudCanvasDocument["content"];
export type StoredCanvasObject = CanvasDocumentContent["objects"][number];

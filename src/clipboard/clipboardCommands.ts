import {
  isCanvasSpatialObject,
  isConnectorObject,
  isStrokeObject,
  type CanvasObject,
} from "../canvas/objects/types";
import { expandIdsToGroups } from "../canvas/groups/grouping";
import { useClipboardStore } from "../store/clipboardStore";
import { useDocumentStore } from "../store/documentStore";
import { useInteractionStore } from "../store/interactionStore";
import { useSelectionStore } from "../store/selectionStore";
import { useUiStore } from "../store/uiStore";

const PASTE_OFFSET = 28;

function selectedObjects(): CanvasObject[] {
  const objects = useDocumentStore.getState().objects;
  const selectedIds = expandIdsToGroups(
    useSelectionStore.getState().selectedIds,
    objects,
  );
  const explicitObjects = [...selectedIds]
    .map((id) => objects[id])
    .filter((object) => object !== undefined);
  const internalConnectors = Object.values(objects).filter(
    (object) =>
      isConnectorObject(object) &&
      !selectedIds.has(object.id) &&
      selectedIds.has(object.from.objectId) &&
      selectedIds.has(object.to.objectId),
  );

  return [...explicitObjects, ...internalConnectors].sort(
    (a, b) => a.zIndex - b.zIndex,
  );
}

export function cloneCanvasObjects(
  source: CanvasObject[],
  offset: number,
  firstZIndex: number,
  createId: () => string = () => crypto.randomUUID(),
  timestamp = Date.now(),
): CanvasObject[] {
  const idMap = new Map(source.map((object) => [object.id, createId()]));
  const groupIdMap = new Map<string, string>();
  for (const object of source) {
    if (object.groupId && !groupIdMap.has(object.groupId)) {
      groupIdMap.set(object.groupId, createId());
    }
  }

  return source.map((object, index) => {
    const base = {
      ...object,
      id: idMap.get(object.id)!,
      zIndex: firstZIndex + index,
      createdAt: timestamp,
      updatedAt: timestamp,
      groupId: object.groupId
        ? groupIdMap.get(object.groupId)
        : undefined,
    };

    if (isStrokeObject(object)) {
      return {
        ...base,
        x: object.x + offset,
        y: object.y + offset,
        points: object.points.map((point) => ({
          ...point,
          x: point.x + offset,
          y: point.y + offset,
        })),
      };
    }

    if (isCanvasSpatialObject(object)) {
      return { ...base, x: object.x + offset, y: object.y + offset };
    }

    return {
      ...base,
      from: {
        ...object.from,
        objectId: idMap.get(object.from.objectId) ?? object.from.objectId,
      },
      to: {
        ...object.to,
        objectId: idMap.get(object.to.objectId) ?? object.to.objectId,
      },
    };
  });
}

function insertClones(
  source: CanvasObject[],
  offset: number,
  label: string,
): void {
  if (source.length === 0) return;
  const documentStore = useDocumentStore.getState();
  const clones = cloneCanvasObjects(
    source,
    offset,
    documentStore.getNextZIndex(),
  );

  documentStore.addObjects(clones, label);
  useSelectionStore.getState().setSelection(clones.map((object) => object.id));
  useInteractionStore.getState().endInteraction();
  useUiStore.getState().setActiveTool("select");
}

export function copySelection(): void {
  const objects = selectedObjects();
  if (objects.length > 0) useClipboardStore.getState().copyObjects(objects);
}

export function pasteClipboard(): void {
  const clipboard = useClipboardStore.getState();
  if (clipboard.objects.length === 0) return;
  const generation = clipboard.nextPasteGeneration();
  insertClones(clipboard.objects, PASTE_OFFSET * generation, "Paste objects");
}

export function duplicateSelection(): void {
  insertClones(selectedObjects(), PASTE_OFFSET, "Duplicate selection");
}

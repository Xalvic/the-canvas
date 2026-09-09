import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useSelectionStore } from "../../store/selectionStore";
import { isCanvasSpatialObject } from "../objects/types";
import { expandIdsToGroups } from "./grouping";

export function groupSelection(): boolean {
  const documentStore = useDocumentStore.getState();
  const selectedIds = expandIdsToGroups(
    useSelectionStore.getState().selectedIds,
    documentStore.objects,
  );
  const spatialIds = [...selectedIds].filter((id) => {
    const object = documentStore.objects[id];
    return object !== undefined && isCanvasSpatialObject(object);
  });
  if (spatialIds.length < 2) return false;

  documentStore.setObjectGroup(
    spatialIds,
    crypto.randomUUID(),
    "Group objects",
  );
  useSelectionStore.getState().setSelection(spatialIds);
  useInteractionStore.getState().endInteraction();
  return true;
}

export function ungroupSelection(): boolean {
  const documentStore = useDocumentStore.getState();
  const selectedIds = useSelectionStore.getState().selectedIds;
  const groupIds = new Set(
    [...selectedIds]
      .map((id) => documentStore.objects[id]?.groupId)
      .filter((groupId): groupId is string => groupId !== undefined),
  );
  if (groupIds.size === 0) return false;

  const memberIds = Object.values(documentStore.objects)
    .filter((object) => object.groupId && groupIds.has(object.groupId))
    .map((object) => object.id);
  documentStore.setObjectGroup(memberIds, null, "Ungroup objects");
  useSelectionStore.getState().setSelection(memberIds);
  useInteractionStore.getState().endInteraction();
  return true;
}

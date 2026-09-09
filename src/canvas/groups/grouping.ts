import { getContainedObjectIds } from "../frames/frameGeometry";
import {
  isCanvasSpatialObject,
  isFrameObject,
  type CanvasObject,
} from "../objects/types";

export function expandIdsToGroups(
  ids: Iterable<string>,
  objects: Record<string, CanvasObject>,
): Set<string> {
  const expanded = new Set(ids);
  const groupIds = new Set(
    [...expanded]
      .map((id) => objects[id]?.groupId)
      .filter((groupId): groupId is string => groupId !== undefined),
  );

  if (groupIds.size === 0) return expanded;
  for (const object of Object.values(objects)) {
    if (object.groupId && groupIds.has(object.groupId)) expanded.add(object.id);
  }
  return expanded;
}

export function toggleObjectOrGroup(
  selectedIds: Iterable<string>,
  objectId: string,
  objects: Record<string, CanvasObject>,
): Set<string> {
  const next = new Set(selectedIds);
  const object = objects[objectId];
  const targetIds = object?.groupId
    ? Object.values(objects)
        .filter((candidate) => candidate.groupId === object.groupId)
        .map((candidate) => candidate.id)
    : [objectId];
  const shouldRemove = targetIds.every((id) => next.has(id));
  for (const id of targetIds) {
    if (shouldRemove) next.delete(id);
    else next.add(id);
  }
  return next;
}

export function getMovementIds(
  selectedIds: Iterable<string>,
  objects: Record<string, CanvasObject>,
): Set<string> {
  let movingIds = expandIdsToGroups(selectedIds, objects);
  let previousSize = -1;

  while (movingIds.size !== previousSize) {
    previousSize = movingIds.size;
    for (const id of movingIds) {
      const object = objects[id];
      if (object && isFrameObject(object) && object.moveContents) {
        for (const childId of getContainedObjectIds(object, objects)) {
          movingIds.add(childId);
        }
      }
    }
    movingIds = expandIdsToGroups(movingIds, objects);
  }

  return new Set(
    [...movingIds].filter((id) => {
      const object = objects[id];
      return object !== undefined && isCanvasSpatialObject(object);
    }),
  );
}

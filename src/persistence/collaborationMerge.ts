import type { CanvasDocument } from "./canvasDocument";

export type StoredCanvasObject = CanvasDocument["content"]["objects"][number];
export type ObjectChange = { id: string; before: StoredCanvasObject | null; after: StoredCanvasObject | null };
export const sameObject = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function documentChanges(before: CanvasDocument, after: CanvasDocument): ObjectChange[] {
  const base = new Map(before.content.objects.map((object) => [object.id, object]));
  const next = new Map(after.content.objects.map((object) => [object.id, object]));
  return [...new Set([...base.keys(), ...next.keys()])].flatMap((id) => sameObject(base.get(id), next.get(id))
    ? [] : [{ id, before: base.get(id) ?? null, after: next.get(id) ?? null }]);
}

/** Merge only independent changes. A conflicting action leaves the draft intact. */
export function mergeCollaborativeDocuments(base: CanvasDocument, local: CanvasDocument, remote: CanvasDocument) {
  const baseline = new Map(base.content.objects.map((object) => [object.id, object]));
  const mine = new Map(local.content.objects.map((object) => [object.id, object]));
  const theirs = new Map(remote.content.objects.map((object) => [object.id, object]));
  const conflicts: string[] = [];
  const objects: StoredCanvasObject[] = [];
  for (const id of new Set([...theirs.keys(), ...mine.keys(), ...baseline.keys()])) {
    const before = baseline.get(id), here = mine.get(id), there = theirs.get(id);
    let merged: StoredCanvasObject | undefined;
    if (sameObject(here, there)) merged = here;
    else if (sameObject(here, before)) merged = there;
    else if (sameObject(there, before)) merged = here;
    else { conflicts.push(id); merged = here; }
    if (merged) objects.push(merged);
  }
  return { document: { schemaVersion: 1, content: { objects } } as CanvasDocument, conflicts };
}

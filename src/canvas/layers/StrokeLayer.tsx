import { useDocumentStore } from "../../store/documentStore";
import { StrokeObjectView } from "../strokes/StrokeObjectView";
import { isStrokeObject } from "../objects/types";

export function StrokeLayer() {
  const objects = useDocumentStore((state) => state.objects);
  return (
    <svg className="stroke-layer" aria-label="Freehand strokes">
      {Object.values(objects)
        .filter(isStrokeObject)
        .map((object) => (
          <StrokeObjectView key={object.id} object={object} />
        ))}
    </svg>
  );
}

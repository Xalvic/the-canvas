import { useDocumentStore } from "../../store/documentStore";
import { CanvasObjectView } from "../objects/CanvasObjectView";
import { isFrameObject } from "../objects/types";

export function FrameLayer() {
  const objects = useDocumentStore((state) => state.objects);

  return (
    <div className="frame-layer">
      {Object.values(objects)
        .filter(isFrameObject)
        .map((object) => (
          <CanvasObjectView key={object.id} object={object} />
        ))}
    </div>
  );
}

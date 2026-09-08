import { useDocumentStore } from "../../store/documentStore";
import { CanvasObjectView } from "../objects/CanvasObjectView";

export function ObjectLayer() {
  const objects = useDocumentStore((state) => state.objects);

  return (
    <div className="object-layer">
      {Object.values(objects).map((object) => (
        <CanvasObjectView key={object.id} object={object} />
      ))}
    </div>
  );
}

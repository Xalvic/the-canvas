import { useEffect, useState } from "react";
import { getAsset } from "../../assets/assetStore";
import type { ImageCanvasObject } from "./types";

type ImageObjectProps = {
  object: ImageCanvasObject;
};

export function ImageObject({ object }: ImageObjectProps) {
  const [source, setSource] = useState<string | null>(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    setSource(null);
    setHasError(false);

    void getAsset(object.assetId)
      .then((blob) => {
        if (disposed) return;
        if (!blob) {
          setHasError(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (!disposed) setHasError(true);
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [object.assetId]);

  if (!source || hasError) {
    return (
      <div className="image-object-placeholder" data-image-error={hasError}>
        {hasError ? "Image unavailable" : "Loading image…"}
      </div>
    );
  }

  return (
    <img
      className="image-object-value"
      src={source}
      alt={object.name || "Canvas image"}
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onError={() => {
        URL.revokeObjectURL(source);
        setSource(null);
        setHasError(true);
      }}
    />
  );
}

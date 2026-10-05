import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAsset } from "../../assets/assetStore";
import { CLOUD_IMAGE_REFRESH_MARGIN_MS, getCloudImageAccess, getCloudImageIdentity, resolveCloudImageReference, subscribeCloudImageIdentity } from "../../assets/cloudImageAccess";
import { useBoardStore } from "../../store/boardStore";
import type { ImageCanvasObject } from "./types";

type ImageObjectProps = {
  object: ImageCanvasObject;
};

export function ImageObject({ object }: ImageObjectProps) {
  const identity = useSyncExternalStore(subscribeCloudImageIdentity, getCloudImageIdentity);
  const account = useBoardStore((state) => state.account);
  const ownerId = account?.ownerId;
  const boardId = account?.boardId;
  const sessionVersion = useBoardStore((state) => state.sessionVersion);
  const accessRole = useBoardStore((state) => state.accessRole);
  const cloudReference = resolveCloudImageReference(object, account);
  const cloudBoardId = cloudReference?.boardId;
  const cloudAssetId = cloudReference?.assetId;
  const canReadCloud = !!identity.userId && identity.userId === ownerId && !!boardId &&
    (accessRole === "owner" || accessRole === "editor" || accessRole === "viewer");
  const key = JSON.stringify([object.assetId, cloudBoardId, cloudAssetId, identity.epoch, boardId, sessionVersion, canReadCloud]);
  const [image, setImage] = useState<{ key: string; source: string | null; error: boolean }>({ key, source: null, error: false });
  const [retry, setRetry] = useState(0);
  const refreshImage = useRef<(() => void) | null>(null);
  const autoRefreshUsed = useRef(false);
  const source = image.key === key ? image.source : null;
  const hasError = image.key === key && image.error;

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reading = false;
    autoRefreshUsed.current = false;
    setImage({ key, source: null, error: false });

    const failed = () => {
      if (!disposed) setImage({ key, source: null, error: true });
    };
    const loadCloud = async (force = false) => {
      if (disposed || reading || document.visibilityState !== "visible" || !identity.userId || !cloudBoardId || !cloudAssetId) return;
      reading = true;
      if (timer) clearTimeout(timer);
      try {
        const asset = await getCloudImageAccess(identity.userId, cloudBoardId, cloudAssetId, force);
        if (disposed) return;
        setImage({ key, source: asset.url, error: false });
        if (document.visibilityState === "visible") {
          timer = setTimeout(() => void loadCloud(), Math.max(1000, asset.expiresAt - Date.now() - CLOUD_IMAGE_REFRESH_MARGIN_MS));
        }
      } catch {
        failed();
      } finally { reading = false; }
    };
    const focus = () => { void loadCloud(); };
    const visibility = () => {
      if (document.visibilityState === "visible") focus();
      else if (timer) { clearTimeout(timer); timer = undefined; }
    };
    refreshImage.current = () => { void loadCloud(true); };

    if (cloudBoardId || cloudAssetId) {
      if (!canReadCloud || !cloudBoardId || !cloudAssetId) failed();
      else {
        void loadCloud(retry > 0);
        window.addEventListener("focus", focus);
        document.addEventListener("visibilitychange", visibility);
      }
    } else void getAsset(object.assetId)
      .then((blob) => {
        if (disposed) return;
        if (!blob) {
          failed();
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImage({ key, source: objectUrl, error: false });
      })
      .catch(failed);

    return () => {
      disposed = true;
      refreshImage.current = null;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", visibility);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [key, retry, object.assetId, identity.userId, cloudBoardId, cloudAssetId, canReadCloud]);

  if (!source || hasError) {
    return (
      <div className="image-object-placeholder" data-image-error={hasError}>
        <span className="image-object-message">{hasError ? "Image unavailable" : "Loading image…"}</span>
        {hasError && (!cloudAssetId || canReadCloud) && (
          <button className="image-object-retry" type="button" aria-label="Retry image" onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); setRetry((value) => value + 1); }}>Retry</button>
        )}
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
      onLoad={() => { autoRefreshUsed.current = false; }}
      onError={() => {
        if (cloudAssetId && !autoRefreshUsed.current) {
          autoRefreshUsed.current = true;
          setImage({ key, source: null, error: false });
          refreshImage.current?.();
        } else {
          if (!cloudAssetId) URL.revokeObjectURL(source);
          setImage({ key, source: null, error: true });
        }
      }}
    />
  );
}

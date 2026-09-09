import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useUiStore } from "../../store/uiStore";
import type { FrameCanvasObject } from "./types";

type FrameObjectProps = {
  object: FrameCanvasObject;
  isEditing: boolean;
};

export function FrameObject({ object, isEditing }: FrameObjectProps) {
  const [draftTitle, setDraftTitle] = useState(object.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const updateObject = useDocumentStore((state) => state.updateObject);
  const endInteraction = useInteractionStore((state) => state.endInteraction);

  useEffect(() => {
    if (!isEditing) setDraftTitle(object.title);
  }, [isEditing, object.title]);

  useEffect(() => {
    if (!isEditing || !inputRef.current) return;
    inputRef.current.focus();
    inputRef.current.select();
  }, [isEditing]);

  const commit = () => {
    updateObject(
      object.id,
      { title: draftTitle.trim() || "Untitled section" },
      "Rename frame",
    );
    endInteraction();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" || event.key === "Enter") {
      event.preventDefault();
      commit();
      if (event.key === "Escape") {
        useUiStore.getState().setActiveTool("select");
      }
    }
  };

  return (
    <div className="frame-object-value">
      <span className="frame-object-fill" aria-hidden="true" />
      <span className="frame-edge-hit frame-edge-hit--top" aria-hidden="true" />
      <span className="frame-edge-hit frame-edge-hit--right" aria-hidden="true" />
      <span className="frame-edge-hit frame-edge-hit--bottom" aria-hidden="true" />
      <span className="frame-edge-hit frame-edge-hit--left" aria-hidden="true" />
      <header className="frame-object-header">
        {isEditing ? (
          <input
            ref={inputRef}
            value={draftTitle}
            aria-label="Frame title"
            onBlur={commit}
            onChange={(event) => setDraftTitle(event.target.value)}
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : (
          <>
            <strong>{object.title}</strong>
          </>
        )}
      </header>
    </div>
  );
}

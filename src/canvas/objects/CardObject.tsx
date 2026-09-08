import {
  useEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import type { CardCanvasObject } from "./types";

type CardObjectProps = {
  object: CardCanvasObject;
  isEditing: boolean;
};

export function CardObject({ object, isEditing }: CardObjectProps) {
  const [draftTitle, setDraftTitle] = useState(object.title);
  const [draftBody, setDraftBody] = useState(object.body);
  const titleRef = useRef<HTMLInputElement>(null);
  const updateObject = useDocumentStore((state) => state.updateObject);
  const endInteraction = useInteractionStore((state) => state.endInteraction);

  useEffect(() => {
    if (isEditing) return;
    setDraftTitle(object.title);
    setDraftBody(object.body);
  }, [isEditing, object.body, object.title]);

  useEffect(() => {
    if (!isEditing || !titleRef.current) return;
    titleRef.current.focus();
    titleRef.current.select();
  }, [isEditing]);

  const commit = () => {
    updateObject(object.id, {
      title: draftTitle.trim() || "Untitled idea",
      body: draftBody.trim(),
    });
    endInteraction();
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    commit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key === "Escape" ||
      (event.key === "Enter" && (event.metaKey || event.ctrlKey))
    ) {
      event.preventDefault();
      commit();
    }
  };

  if (isEditing) {
    return (
      <div
        className="card-object-editor"
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <input
          ref={titleRef}
          value={draftTitle}
          aria-label="Card title"
          onChange={(event) => setDraftTitle(event.target.value)}
          placeholder="Idea title"
        />
        <textarea
          value={draftBody}
          aria-label="Card body"
          onChange={(event) => setDraftBody(event.target.value)}
          placeholder="Add a thought…"
          spellCheck="true"
        />
      </div>
    );
  }

  return (
    <div className="card-object-value">
      <strong>{object.title}</strong>
      {object.body && <p>{object.body}</p>}
    </div>
  );
}

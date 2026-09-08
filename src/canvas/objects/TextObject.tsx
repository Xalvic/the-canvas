import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import type { TextCanvasObject } from "./types";

type TextObjectProps = {
  object: TextCanvasObject;
  isEditing: boolean;
};

export function TextObject({ object, isEditing }: TextObjectProps) {
  const [draft, setDraft] = useState(object.text);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const updateObject = useDocumentStore((state) => state.updateObject);
  const endInteraction = useInteractionStore((state) => state.endInteraction);

  useEffect(() => {
    if (!isEditing) setDraft(object.text);
  }, [isEditing, object.text]);

  useEffect(() => {
    if (!isEditing || !editorRef.current) return;
    editorRef.current.focus();
    editorRef.current.select();
  }, [isEditing]);

  const commit = () => {
    const text = draft.trim() || "Untitled text";
    const measuredHeight = editorRef.current?.scrollHeight ?? object.height;
    updateObject(object.id, {
      text,
      height: Math.max(52, measuredHeight),
    });
    endInteraction();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
      <textarea
        ref={editorRef}
        className="text-object-editor"
        value={draft}
        aria-label="Edit text"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
        spellCheck="true"
      />
    );
  }

  return <div className="text-object-value">{object.text}</div>;
}

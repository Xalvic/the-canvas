import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useUiStore } from "../../store/uiStore";
import type { TextCanvasObject } from "./types";
import { getTextStyle } from "./textAppearance";
import { useObjectOpacity } from "../../store/appearancePreviewStore";

type TextObjectProps = {
  object: TextCanvasObject;
  isEditing: boolean;
};

export function TextObject({ object, isEditing }: TextObjectProps) {
  const opacity = useObjectOpacity(object.id, object.opacity);
  const style = { ...getTextStyle(object), opacity };
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

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!isEditing || !editor) return;
    editor.style.height = "auto";
    const height = Math.max(36, editor.scrollHeight);
    editor.style.height = `${height}px`;
    if (editor.parentElement) editor.parentElement.style.height = `${height + 16}px`;
  }, [draft, isEditing, object.fontSize, object.fontWeight, object.width]);

  const commit = () => {
    const text = draft.trim() || "Untitled text";
    const measuredHeight = editorRef.current?.scrollHeight ?? object.height;
    updateObject(object.id, {
      text,
      height: Math.max(52, measuredHeight + 16),
    }, "Edit text");
    endInteraction();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      commit();
      useUiStore.getState().setActiveTool("select");
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      commit();
    }
  };

  if (isEditing) {
    return (
      <textarea
        ref={editorRef}
        className="text-object-editor"
        style={style}
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

  return <div className="text-object-value" style={style}>{object.text}</div>;
}

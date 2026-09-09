import { beforeEach, describe, expect, it } from "vitest";
import { useAppearancePreviewStore } from "./appearancePreviewStore";
import { useDocumentStore } from "./documentStore";
import { createStrokeObject } from "../canvas/strokes/strokeFactories";
import { createTextObject } from "../canvas/objects/objectFactories";

describe("appearance history", () => {
  beforeEach(() => {
    useDocumentStore.getState().loadDocument({});
    useAppearancePreviewStore.getState().cancel();
  });

  it.each(["stroke", "text"])(
    "previews a %s slider without changing persisted content, then commits one undo step",
    (type) => {
      const object =
        type === "stroke"
          ? createStrokeObject([{ x: 0, y: 0 }], 1)
          : createTextObject({ x: 0, y: 0 }, 1);
      useDocumentStore.getState().loadDocument({ [object.id]: object });
      for (let i = 1; i <= 50; i++)
        useAppearancePreviewStore.getState().setOpacity(object.id, i / 100);
      expect(useDocumentStore.getState().objects[object.id]).toBe(object);
      expect(useDocumentStore.getState().past).toHaveLength(0);
      useAppearancePreviewStore.getState().commit();
      useAppearancePreviewStore.getState().commit();
      expect(useDocumentStore.getState().past).toHaveLength(1);
      expect(useDocumentStore.getState().objects[object.id]).toMatchObject({
        opacity: 0.5,
      });
      useDocumentStore.getState().undo();
      expect(useDocumentStore.getState().objects[object.id]).toBe(object);
      useDocumentStore.getState().redo();
      expect(useDocumentStore.getState().objects[object.id]).toMatchObject({
        opacity: 0.5,
      });
    },
  );

  it("cancels interrupted sliders and skips unchanged opacity", () => {
    const text = createTextObject({ x: 0, y: 0 }, 1);
    useDocumentStore.getState().loadDocument({ [text.id]: text });
    useAppearancePreviewStore.getState().setOpacity(text.id, 0);
    useAppearancePreviewStore.getState().cancel();
    useAppearancePreviewStore.getState().commit();
    useAppearancePreviewStore.getState().setOpacity(text.id, 1);
    useAppearancePreviewStore.getState().commit();
    expect(useDocumentStore.getState().past).toHaveLength(0);
    expect(useDocumentStore.getState().objects[text.id]).toBe(text);
  });
});

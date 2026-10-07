import { useState, type KeyboardEvent } from "react";
import {
  DEFAULT_BOARD_TITLE,
  useBoardStore,
} from "../../store/boardStore";

export function BoardIdentity({ location }: { location?: string }) {
  const title = useBoardStore((state) => state.title);
  const readOnly = useBoardStore((state) => state.readOnly);
  const isHydrated = useBoardStore((state) => state.isHydrated);
  const setTitle = useBoardStore((state) => state.setTitle);
  const account = useBoardStore((state) => state.account);
  const [draft, setDraft] = useState<string | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setDraft(null);
      event.currentTarget.value = title;
      event.currentTarget.blur();
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.currentTarget.blur();
    }
  };

  return (
    <div
      className="brand-mark"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <img
        className="brand-symbol"
        src={`${import.meta.env.BASE_URL}favicon.svg`}
        alt=""
        aria-hidden="true"
      />
      <div className="board-identity-copy">
        <input
          className="board-title-input"
          aria-label={account ? "Page title" : "Drawing title"}
          value={draft ?? title}
          disabled={!isHydrated || readOnly}
          maxLength={120}
          size={Math.min(18, Math.max(8, title.length))}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            const nextTitle = event.currentTarget.value.trim();
            setTitle(nextTitle || DEFAULT_BOARD_TITLE);
            setDraft(null);
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
        {location && <span className="board-location">{location}</span>}
      </div>
    </div>
  );
}

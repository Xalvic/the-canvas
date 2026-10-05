import { type KeyboardEvent } from "react";
import {
  DEFAULT_BOARD_TITLE,
  useBoardStore,
} from "../../store/boardStore";

export function BoardIdentity() {
  const title = useBoardStore((state) => state.title);
  const readOnly = useBoardStore((state) => state.readOnly);
  const isHydrated = useBoardStore((state) => state.isHydrated);
  const saveStatus = useBoardStore((state) => state.saveStatus);
  const saveError = useBoardStore((state) => state.saveError);
  const setTitle = useBoardStore((state) => state.setTitle);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Escape") {
      event.currentTarget.blur();
    }
  };

  return (
    <header
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
          aria-label="Board title"
          value={title}
          disabled={!isHydrated || readOnly}
          maxLength={80}
          size={Math.min(18, Math.max(8, title.length))}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            const nextTitle = event.currentTarget.value.trim();
            setTitle(nextTitle || DEFAULT_BOARD_TITLE);
          }}
          onFocus={(event) => event.currentTarget.select()}
        />
        {saveStatus === "error" && <span
          className="board-save-status"
          data-status={saveStatus}
          title={saveError ?? undefined}
          role="alert"
        >
          <i aria-hidden="true" />
          Save failed
        </span>}
      </div>
    </header>
  );
}

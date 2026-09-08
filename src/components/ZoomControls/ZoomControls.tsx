import { MinusIcon, PlusIcon, ResetIcon } from "../icons";

type ZoomControlsProps = {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
};

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: ZoomControlsProps) {
  return (
    <div className="zoom-controls" role="group" aria-label="Viewport controls">
      <button
        className="icon-button"
        type="button"
        onClick={onReset}
        aria-label="Reset viewport"
        title="Reset view (0)"
      >
        <ResetIcon />
      </button>
      <span className="control-divider" aria-hidden="true" />
      <button
        className="icon-button"
        type="button"
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <MinusIcon />
      </button>
      <output className="zoom-value" aria-live="polite" aria-label="Current zoom">
        {Math.round(zoom * 100)}%
      </output>
      <button
        className="icon-button"
        type="button"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

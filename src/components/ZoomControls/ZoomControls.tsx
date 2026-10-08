import { MinusIcon, PlusIcon, ResetIcon } from "../icons";
import { ChevronDown } from "lucide-react";
import { Menu } from "../Menu";

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
        onClick={onZoomOut}
        aria-label="Zoom out"
        title="Zoom out"
      >
        <MinusIcon aria-hidden="true" />
      </button>
      <Menu label="Zoom options" className="zoom-menu" triggerClass="zoom-value" viewportBounded trigger={<>
        <output aria-live="polite" aria-label="Current zoom">{Math.round(zoom * 100)}%</output>
        <ChevronDown aria-hidden="true" />
      </>}>
        <button type="button" role="menuitem" aria-label="Reset viewport" onClick={onReset}>
          <ResetIcon aria-hidden="true" /> Reset view <kbd>0</kbd>
        </button>
        <button type="button" role="menuitem" onClick={onZoomOut}><MinusIcon aria-hidden="true" /> Zoom out</button>
        <button type="button" role="menuitem" onClick={onZoomIn}><PlusIcon aria-hidden="true" /> Zoom in</button>
      </Menu>
      <button
        className="icon-button"
        type="button"
        onClick={onZoomIn}
        aria-label="Zoom in"
        title="Zoom in"
      >
        <PlusIcon aria-hidden="true" />
      </button>
    </div>
  );
}

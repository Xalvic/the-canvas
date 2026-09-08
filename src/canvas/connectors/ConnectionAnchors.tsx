import type { ConnectionAnchor } from "../objects/types";

type ConnectionAnchorsProps = {
  objectId: string;
};

const anchors: ConnectionAnchor[] = ["top", "right", "bottom", "left"];

export function ConnectionAnchors({ objectId }: ConnectionAnchorsProps) {
  return (
    <div className="connection-anchors">
      {anchors.map((anchor) => (
        <button
          className={`connection-anchor connection-anchor--${anchor}`}
          type="button"
          key={anchor}
          tabIndex={-1}
          data-connection-object={objectId}
          data-connection-anchor={anchor}
          aria-label={`Connect from ${anchor}`}
        />
      ))}
    </div>
  );
}

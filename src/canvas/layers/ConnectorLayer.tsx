import { useDocumentStore } from "../../store/documentStore";
import { useInteractionStore } from "../../store/interactionStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useUiStore } from "../../store/uiStore";
import { getNodeObjects } from "../../utils/geometry";
import {
  buildConnectorPath,
  getEndpointPoint,
} from "../connectors/connectorGeometry";
import { isConnectorObject } from "../objects/types";

export function ConnectorLayer() {
  const objects = useDocumentStore((state) => state.objects);
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const interactionMode = useInteractionStore((state) => state.mode);
  const interactionObjectId = useInteractionStore((state) => state.objectId);
  const activeTool = useUiStore((state) => state.activeTool);
  const nodes = getNodeObjects(objects);
  const connectors = Object.values(objects)
    .filter(isConnectorObject)
    .map((connector) => {
      const from = getEndpointPoint(connector.from, nodes);
      const to = getEndpointPoint(connector.to, nodes);
      if (!from || !to) return null;
      return {
        connector,
        from,
        to,
        path: buildConnectorPath(
          from,
          to,
          connector.from.anchor,
          connector.to.anchor,
        ),
      };
    })
    .filter((value) => value !== null);

  const selectConnector = (
    event: React.PointerEvent<SVGPathElement>,
    connectorId: string,
  ) => {
    const activeTool = useUiStore.getState().activeTool;
    const isSpacePressed =
      event.currentTarget.closest<HTMLElement>(".canvas-viewport")?.dataset
        .spacePressed === "true";
    if (event.button !== 0 || activeTool === "hand" || isSpacePressed) return;
    if (activeTool !== "select") return;

    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      useSelectionStore.getState().toggleSelection(connectorId);
    } else {
      useSelectionStore.getState().selectOnly(connectorId);
    }
  };

  return (
    <>
      <svg className="connector-layer" aria-label="Connectors">
        <defs>
          <marker
            id="connector-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" className="connector-arrow" />
          </marker>
          <marker
            id="connector-arrow-selected"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M 0 0 L 10 5 L 0 10 z"
              className="connector-arrow-selected"
            />
          </marker>
        </defs>

        {connectors.map(({ connector, path }) => {
          const isSelected = selectedIds.has(connector.id);
          const isReconnecting =
            interactionMode === "connecting" &&
            interactionObjectId === connector.id;

          return (
            <g
              key={connector.id}
              className={`connector${isSelected ? " is-selected" : ""}${isReconnecting ? " is-reconnecting" : ""}`}
              data-connector-object-id={connector.id}
            >
              <path
                className="connector-hit-area"
                d={path}
                data-connector-path-id={connector.id}
                onPointerDown={(event) => selectConnector(event, connector.id)}
              />
              <path
                className="connector-path"
                d={path}
                data-connector-path-id={connector.id}
                markerEnd={
                  connector.directed
                    ? `url(#${isSelected ? "connector-arrow-selected" : "connector-arrow"})`
                    : undefined
                }
              />
            </g>
          );
        })}
      </svg>

      <svg className="connector-handle-layer" aria-label="Connector endpoints">
        {activeTool === "select" &&
          connectors.map(({ connector, from, to }) =>
            selectedIds.has(connector.id) ? (
              <g key={connector.id}>
                <circle
                  className="connector-endpoint-handle"
                  cx={from.x}
                  cy={from.y}
                  r={6}
                  data-connector-endpoint="true"
                  data-connector-id={connector.id}
                  data-connector-end="from"
                  data-connector-handle-id={connector.id}
                />
                <circle
                  className="connector-endpoint-handle"
                  cx={to.x}
                  cy={to.y}
                  r={6}
                  data-connector-endpoint="true"
                  data-connector-id={connector.id}
                  data-connector-end="to"
                  data-connector-handle-id={connector.id}
                />
              </g>
            ) : null,
          )}
      </svg>
    </>
  );
}

import type {
  ConnectionEndpoint,
  ConnectorCanvasObject,
} from "../objects/types";

export function createConnectorObject(
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
  zIndex: number,
  directed = true,
): ConnectorCanvasObject {
  const timestamp = Date.now();
  return {
    id: crypto.randomUUID(),
    type: "connector",
    from,
    to,
    directed,
    zIndex,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

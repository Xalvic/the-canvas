import { CanvasViewport } from "./canvas/viewport/CanvasViewport";
import { ServerBoards } from "./components/ServerBoards/ServerBoards";
import { useLocalBoardPersistence } from "./persistence/useLocalBoardPersistence";
import { CollaborationPresence } from "./components/CollaborationPresence";

export default function App() {
  useLocalBoardPersistence();

  return (
    <main className="app-shell">
      <div id="canvas-editor">
        <CanvasViewport />
        <CollaborationPresence />
      </div>
      <ServerBoards />
    </main>
  );
}

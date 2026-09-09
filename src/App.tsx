import { CanvasViewport } from "./canvas/viewport/CanvasViewport";
import { useLocalBoardPersistence } from "./persistence/useLocalBoardPersistence";

export default function App() {
  useLocalBoardPersistence();

  return (
    <main className="app-shell">
      <CanvasViewport />
    </main>
  );
}

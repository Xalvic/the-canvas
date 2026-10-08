import { useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis, CircleHelp, Moon, Sun } from "lucide-react";
import { Menu } from "./Menu";
import { HelpDialog } from "./HelpDialog";
import { useThemeStore } from "../store/themeStore";
import { useBoardStore } from "../store/boardStore";
import { useDocumentStore } from "../store/documentStore";
import { useViewportStore } from "../store/viewportStore";
import { getAsset } from "../assets/assetStore";
import { downloadBoardAsset } from "../api/assets";
import { COMMIT_CANVAS_INTERACTIONS_EVENT } from "../canvas/viewport/pointerInteractionEvents";
import { flushLocalBoardSave } from "../persistence/useLocalBoardPersistence";

export function AppMenu({ details, blocked, footerTarget, linkSettings }: { details: () => void; blocked: boolean; footerTarget?: HTMLElement | null; linkSettings?: () => void }) {
  const [help, setHelp] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState<string | null>(null);
  const theme = useThemeStore((store) => store.preference), setTheme = useThemeStore((store) => store.setPreference);
  async function exportDrawing() {
    if (exporting || blocked) return;
    setExporting(true); setError(null);
    try {
      window.dispatchEvent(new Event(COMMIT_CANVAS_INTERACTIONS_EVENT));
      await flushLocalBoardSave();
      const board = useBoardStore.getState(), version = board.sessionVersion;
      const objects = structuredClone(useDocumentStore.getState().objects);
      const viewport = { ...useViewportStore.getState().viewport };
      const images: { id: string; data: string }[] = [];
      for (const object of Object.values(objects)) {
        if (object.type !== "image" || images.some((image) => image.id === object.assetId)) continue;
        let blob = await getAsset(object.assetId);
        const cloud = object.cloudAsset ?? (board.account?.imageAssets?.[object.assetId] ? { boardId: board.account.boardId, assetId: board.account.imageAssets[object.assetId] } : null);
        if (!blob && cloud && board.account) blob = await downloadBoardAsset(cloud.boardId, cloud.assetId, AbortSignal.timeout(20000), board.account.ownerId);
        if (!blob) throw new Error("An image file is unavailable. Restore it before exporting this drawing.");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
        });
        images.push({ id: object.assetId, data });
      }
      if (useBoardStore.getState().sessionVersion !== version) throw new Error("The page changed during export. Try again on the current drawing.");
      const blob = new Blob([JSON.stringify({ format: "scribble-drawing", version: 1, title: board.title, objects, viewport, images })], { type: "application/json" });
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `${board.title.replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 80) || "drawing"}.scribble.json`;
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : "Couldn’t export the drawing."); }
    finally { setExporting(false); }
  }
  return <>
    <Menu label="App menu" trigger={<Ellipsis size={20} aria-hidden="true" />} triggerClass="app-menu-trigger icon-button">
      <strong>Scribble</strong>
      {linkSettings && <button type="button" role="menuitem" disabled={blocked} onClick={linkSettings}>Link settings</button>}
      <button type="button" role="menuitem" disabled={blocked || exporting} onClick={() => void exportDrawing()}>{exporting ? "Exporting…" : "Export drawing data"}</button>
      <button type="button" role="menuitem" disabled={blocked} onClick={details}>Save details</button>
      {!footerTarget && <>
        <button type="button" role="menuitem" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "Light theme" : "Dark theme"}</button>
        <button type="button" role="menuitem" onClick={() => setHelp(true)}>Help and shortcuts</button>
      </>}
    </Menu>
    {footerTarget && createPortal(<>
      <button className="ui-button sidebar-help" type="button" onClick={() => setHelp(true)}><CircleHelp size={18} aria-hidden="true" />Help and shortcuts</button>
      <button className="ui-button icon-button" type="button" aria-label={theme === "dark" ? "Light theme" : "Dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}</button>
    </>, footerTarget)}
    <HelpDialog open={help} close={() => setHelp(false)} />
    {error && <div className="board-notice" data-tone="error" role="alert">{error}<button type="button" onClick={() => setError(null)}>Dismiss</button></div>}
  </>;
}

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/** Native modal semantics; durable sessions live outside this presentation layer. */
export function Dialog({ open, title, close, children, className = "", dismissOnBackdrop = false }: {
  open: boolean; title: string; close: () => void; children: ReactNode; className?: string; dismissOnBackdrop?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    if (!open || !ref.current) return;
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    const initial = dialog.querySelector<HTMLElement>("[data-initial-focus]") ?? dialog.querySelector<HTMLElement>("button");
    initial?.focus();
    // Capture in the DOM: footer controls may be portals owned outside this dialog.
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]")].filter((element) =>
        element.closest("dialog") === dialog && element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    dialog.addEventListener("keydown", containFocus, true);
    return () => {
      dialog.removeEventListener("keydown", containFocus, true);
      dialog.close();
      if (trigger?.isConnected && !trigger.closest("dialog:not([open])")) trigger.focus();
      else document.querySelector<HTMLElement>(".workspace-title-controls .app-menu-trigger")?.focus();
    };
  }, [open]);
  return open ? <dialog ref={ref} className={`app-dialog ${className}`} aria-labelledby={heading}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose.current(); }}
    onKeyDown={(event) => event.stopPropagation()} onKeyUp={(event) => event.stopPropagation()}
    onPointerDown={(event) => {
      event.stopPropagation();
      if (!dismissOnBackdrop || event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
        event.preventDefault(); onClose.current();
      }
    }}>
    <div className="dialog-heading"><h2 id={heading}>{title}</h2>
      <button type="button" aria-label={`Close ${title}`} className="ui-button icon-button" onClick={close}><X size={20} aria-hidden="true" /></button></div>
    {children}
  </dialog> : null;
}

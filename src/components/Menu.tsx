import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/** A small non-modal menu; it never changes the editor's selection or history. */
export function Menu({ label, trigger, children, className = "", triggerClass = "" }: {
  label: string; trigger: ReactNode; children: ReactNode; className?: string; triggerClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = () => { setOpen(false); button.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className={`menu-root ${className}`} onKeyDown={(event) => {
    event.stopPropagation();
    if (!open) return;
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Tab") setOpen(false);
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
      (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }} onKeyUp={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <button ref={button} type="button" className={triggerClass} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}>{trigger}</button>
    {open && <div id={id} role="menu" aria-label={label} className="popup-menu" onClick={(event) => {
      if (event.target instanceof Element && event.target.closest('[role^="menuitem"]')) close();
    }}>{children}</div>}
  </div>;
}

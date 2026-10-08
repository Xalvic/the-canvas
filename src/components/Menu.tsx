import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** A small non-modal menu; it never changes the editor's selection or history. */
export function Menu({ label, trigger, children, className = "", triggerClass = "", viewportBounded = false }: {
  label: string; trigger: ReactNode; children: ReactNode; className?: string; triggerClass?: string; viewportBounded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); button.current?.focus(); };
  useLayoutEffect(() => {
    if (!open || !viewportBounded || !button.current || !popup.current) return;
    const menu = popup.current;
    const measure = () => {
      const bounds = button.current!.getBoundingClientRect(), viewport = window.visualViewport;
      const listBounds = button.current!.closest(".sidebar-pages")?.getBoundingClientRect();
      if (listBounds && (bounds.bottom <= listBounds.top || bounds.top >= listBounds.bottom)) { setOpen(false); return; }
      const top = (viewport?.offsetTop ?? 0) + 8, bottom = top + (viewport?.height ?? innerHeight) - 16;
      const left = (viewport?.offsetLeft ?? 0) + 8, right = left + (viewport?.width ?? innerWidth) - 16;
      const below = Math.max(0, bottom - bounds.bottom - 6), above = Math.max(0, bounds.top - top - 6);
      const down = menu.scrollHeight <= below || below >= above;
      menu.style.maxHeight = `${down ? below : above}px`;
      menu.style.left = `${Math.max(left, Math.min(bounds.left, right - menu.offsetWidth))}px`;
      menu.style.top = `${down ? bounds.bottom + 6 : Math.max(top, bounds.top - menu.offsetHeight - 6)}px`;
    };
    const scroll = (event: Event) => { if (event.target instanceof Node && !menu.contains(event.target)) measure(); };
    measure(); window.addEventListener("resize", measure); window.addEventListener("scroll", scroll, true);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure); window.removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [open, viewportBounded]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
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
    <button ref={button} type="button" className={`ui-button ${triggerClass}`} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}>{trigger}</button>
    {open && <div ref={popup} id={id} role="menu" aria-label={label} className="popup-menu" onClick={(event) => {
      if (event.target instanceof Element && event.target.closest('[role^="menuitem"]')) close();
    }}>{children}</div>}
  </div>;
}

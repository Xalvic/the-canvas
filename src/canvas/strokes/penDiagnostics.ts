type InputState = { owner: number | null; contacts: number; pinching: boolean };

// Installed only in development. No console output, board data, or work until
// explicitly started from DevTools; overwrite a bounded ring on long captures.
export function installPenDiagnostics(surface: HTMLElement, state: () => InputState) {
  const records: unknown[] = [];
  let cursor = 0;
  let running = false;
  const capacity = 2048;
  const record = (event: Event) => {
    if (!running || !(event instanceof PointerEvent)) return;
    records[cursor % capacity] = {
      event: event.type, id: event.pointerId, input: event.pointerType,
      time: event.timeStamp, x: event.clientX, y: event.clientY,
      pressure: event.pressure, buttons: event.buttons,
      captured: surface.hasPointerCapture(event.pointerId),
      coalesced: typeof event.getCoalescedEvents === "function",
      ...state(),
    };
    cursor++;
  };
  const api = {
    start() { records.length = 0; cursor = 0; running = true; },
    stop() { running = false; },
    read() {
      const start = cursor > capacity ? cursor % capacity : 0;
      return {
        origin: location.origin, secure: isSecureContext, userAgent: navigator.userAgent,
        devicePixelRatio, events: [...records.slice(start), ...records.slice(0, start)],
      };
    },
  };
  const target = window as Window & { scribblePenDiagnostics?: typeof api };
  target.scribblePenDiagnostics = api;
  const names = ["pointerdown", "pointermove", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"];
  names.forEach((name) => surface.addEventListener(name, record, true));
  return () => {
    names.forEach((name) => surface.removeEventListener(name, record, true));
    if (target.scribblePenDiagnostics === api) delete target.scribblePenDiagnostics;
  };
}

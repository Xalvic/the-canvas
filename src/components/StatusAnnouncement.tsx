import { useEffect, useState } from "react";

export function StatusAnnouncement({ message, urgent = false }: { message: string; urgent?: boolean }) {
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    // Routine autosave frames don't blank/repeat a successful announcement.
    if (/^(Saving|Opening|Changes waiting)/.test(message)) return;
    const timer = setTimeout(() => setAnnouncement(message), 800);
    return () => clearTimeout(timer);
  }, [message]);
  return <span className="visually-hidden" role={urgent ? "alert" : "status"} aria-live={urgent ? "assertive" : "polite"} aria-atomic="true">{urgent ? message : announcement}</span>;
}

import { useSyncExternalStore } from "react";
import { ACCOUNT_METADATA_INTERVAL } from "../../api/accountBoardQueries";

function subscribe(listener: () => void) {
  document.addEventListener("visibilitychange", listener);
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    document.removeEventListener("visibilitychange", listener);
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
const available = () => document.visibilityState !== "hidden" && navigator.onLine !== false;

/** Visibility/network changes never touch canvas interaction or persistence state. */
export function useVisiblePolling(active = true) {
  const canPoll = useSyncExternalStore(subscribe, available);
  return active && canPoll ? ACCOUNT_METADATA_INTERVAL : false;
}

import { useSyncExternalStore } from "react";

/** The screen shown: the part of the address after "#", "/" when there is none. */
const read = () => location.hash.replace(/^#/, "") || "/";
const subscribe = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};

export const useHashPath = () => useSyncExternalStore(subscribe, read, () => "/");

export function go(path: string) {
  location.hash = path;
}

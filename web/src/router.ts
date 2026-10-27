import { useEffect, useState } from "react";

// Hash routes work on GitHub Pages without any server rewrites.
export function go(path: string) {
  window.location.hash = path;
  window.scrollTo(0, 0);
}

export function useRoute() {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

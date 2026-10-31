"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
const searches = new Map();
export function ConceptNavigation({ children, documentKey }) {
  const main = useRef(null),
    router = useRouter();
  useEffect(() => {
    function legacy() {
      if (!location.hash.startsWith("#/")) return;
      const [key, ...anchors] = location.hash.slice(1).split("~");
      if (!/^\/(?:index|terms\/[a-z0-9-]+|quiz\/q\d+)\.html$/.test(key)) return;
      router.replace(
        "/concepts/" +
          (key === "/index.html" ? "" : key.slice(1, -5) + "/") +
          (anchors.length ? "#" + anchors.join("~") : ""),
      );
    }
    legacy();
    window.addEventListener("hashchange", legacy);
    return () => window.removeEventListener("hashchange", legacy);
  }, [router]);
  useEffect(() => {
    const toc = main.current.querySelector(".wiki-toc details");
    if (toc && matchMedia("(max-width:800px)").matches) toc.open = false;
    const search = main.current.querySelector("#term-search");
    if (!search) return;
    const groups = [...main.current.querySelectorAll(".letter-group")],
      empty = main.current.querySelector("#no-results"),
      alphabet = main.current.querySelector(".alphabet");
    function filter() {
      const needle = search.value.trim().toLocaleLowerCase();
      let visible = 0;
      for (const group of groups) {
        let hits = 0;
        for (const item of group.querySelectorAll(".dictionary-item")) {
          const match = item.dataset.search.includes(needle);
          item.hidden = !match;
          if (match) {
            hits++;
            visible++;
          }
        }
        group.hidden = !hits;
      }
      empty.hidden = visible !== 0;
      alphabet.hidden = !!needle;
    }
    search.value = searches.get(documentKey) || "";
    filter();
    search.addEventListener("input", filter);
    return () => {
      searches.set(documentKey, search.value);
      search.removeEventListener("input", filter);
    };
  }, [documentKey]);
  useEffect(() => {
    let frame;
    const jump = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!location.hash || location.hash.startsWith("#/")) return;
        let id;
        try {
          id = decodeURIComponent(location.hash.slice(1));
        } catch {
          return;
        }
        const target = document.getElementById(id);
        if (!target || !main.current?.contains(target)) return;
        const details = target.closest("details");
        if (details) details.open = true;
        target.scrollIntoView({ block: "start" });
        if (!target.hasAttribute("tabindex"))
          target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      });
    };
    jump();
    window.addEventListener("hashchange", jump);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", jump);
    };
  }, [documentKey]);
  return (
    <main id="main" className="shell" tabIndex={-1} ref={main}>
      {children}
    </main>
  );
}

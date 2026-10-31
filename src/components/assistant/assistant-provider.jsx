"use client";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { AssistantContext } from "./ai-button";
import { AssistantShell } from "./assistant-shell";
export function AssistantProvider({ children }) {
  const [api, setApi] = useState(null),
    [mounted, setMounted] = useState(false);
  const path = usePathname();
  const ready = useCallback((value) => setApi(value), []);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    api?.hideTooltip();
  }, [path, api]);
  return (
    <AssistantContext.Provider value={api}>
      {children}
      {mounted &&
        path !== "/" &&
        createPortal(<AssistantShell onReady={ready} />, document.body)}
    </AssistantContext.Provider>
  );
}

const stateKey = "saa-c03-assistant";

// A mobile dialog owns one same-URL entry. Preserve Next.js's history metadata.
export function createPanelNavigation({ panel, mobile, show, hide, visit }) {
  const saved = history.state?.[stateKey];
  let pageUrl = location.href;
  let id =
    saved?.url === location.href && typeof saved.id === "string"
      ? saved.id
      : crypto.randomUUID();
  let ownedEntry = isEntry(), pendingUrl = null, pendingDestination = null;
  let sourceDestination = null;
  const lifetime = new AbortController();

  function isEntry() {
    const entry = history.state?.[stateKey];
    return entry?.id === id && entry.url === location.href;
  }
  function sync() {
    if (pendingUrl) return;
    if (sourceDestination) {
      if (location.href !== sourceDestination) return;
      sourceDestination = null;
    }
    if (!panel.hidden && mobile.matches) {
      if (pageUrl !== location.href) {
        pageUrl = location.href;
        id = crypto.randomUUID();
      }
      if (!isEntry()) {
        history.pushState(
          { ...history.state, [stateKey]: { id, url: location.href } },
          "",
        );
      }
      ownedEntry = true;
    } else if (isEntry()) {
      // Closing with X/Escape also consumes the entry, rather than leaving a
      // duplicate page behind. An immediate reopen waits for this traversal.
      pendingUrl = location.href;
      ownedEntry = false;
      history.back();
    }
  }
  window.addEventListener("popstate", () => {
    if (pendingUrl) {
      const expectedUrl = pendingUrl;
      const destination = pendingDestination;
      pendingUrl = null;
      pendingDestination = null;
      if (location.href !== expectedUrl) {
        sourceDestination = null;
        hide();
      }
      else if (destination) {
        // Let history restore the document first; otherwise it can overwrite
        // the source link's scroll position and focus, especially on mobile.
        setTimeout(() => {
          if (!lifetime.signal.aborted && location.href === expectedUrl && sourceDestination === new URL(destination, location.href).href) {
            visit(destination);
            sync();
          }
        }, 0);
      }
      else sync();
      return;
    }
    // Forward can revisit the dialog after a full page navigation created a
    // new controller. Adopt only this page's existing assistant entry.
    const entry = history.state?.[stateKey];
    if (entry?.url === pageUrl && location.href === pageUrl && typeof entry.id === "string") {
      id = entry.id;
    }
    if (isEntry()) {
      ownedEntry = true;
      if (mobile.matches) show();
      else sync();
    } else if (ownedEntry) {
      ownedEntry = false;
      hide();
    }
  }, { signal: lifetime.signal });
  mobile.addEventListener("change", sync, { signal: lifetime.signal });
  return {
    sync,
    navigate(destination) {
      sourceDestination = new URL(destination, location.href).href;
      // Move the mobile dialog entry to the destination while keeping the
      // conversation visible. Back then closes it on the new source page.
      if (pendingUrl) pendingDestination = destination;
      else if (isEntry()) {
        pendingDestination = destination;
        pendingUrl = location.href;
        ownedEntry = false;
        history.back();
      } else {
        visit(destination);
        sync();
      }
    },
    restore() {
      if (!isEntry()) return;
      if (mobile.matches) show();
      else sync();
    },
    dispose() { lifetime.abort(); },
  };
}

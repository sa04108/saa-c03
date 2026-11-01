export function createPanelViewport({ panel, mobile }) {
  const lifetime = new AbortController();
  const visibleViewport = window.visualViewport;
  let frame = 0;

  function clear() {
    cancelAnimationFrame(frame);
    frame = 0;
    panel.style.removeProperty("--ai-visible-height");
    panel.style.removeProperty("--ai-visible-top");
  }
  function sync() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (lifetime.signal.aborted) return;
    if (!mobile.matches || panel.hidden || !visibleViewport) return clear();
    const height = visibleViewport.height;
    const top = Math.max(0, visibleViewport.offsetTop);
    // With interactive-widget=resizes-content, CSS follows the resized layout
    // viewport itself. Only compensate when a browser keeps that viewport
    // larger than its visible area (or when the user has zoomed/panned).
    if (!Number.isFinite(height) || height <= 0 ||
        (height >= document.documentElement.clientHeight - 1 && top < 1))
      return clear();
    for (const [name, value] of [
      ["--ai-visible-height", height],
      ["--ai-visible-top", top],
    ]) {
      const pixels = value + "px";
      if (panel.style.getPropertyValue(name) !== pixels)
        panel.style.setProperty(name, pixels);
    }
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(sync);
  }
  const options = { signal: lifetime.signal, passive: true };
  visibleViewport?.addEventListener("resize", schedule, options);
  visibleViewport?.addEventListener("scroll", schedule, options);
  window.addEventListener("resize", schedule, options);
  mobile.addEventListener("change", schedule, options);

  return {
    sync,
    dispose() {
      lifetime.abort();
      clear();
    },
  };
}

export function createPanelViewport({ panel, mobile }) {
  const lifetime = new AbortController();
  const visibleViewport = window.visualViewport;
  const prompt = panel.querySelector("textarea");
  let frame = 0, settleUntil = 0;

  function clear() {
    cancelAnimationFrame(frame);
    frame = 0;
    settleUntil = 0;
    panel.style.removeProperty("--ai-visible-height");
    panel.style.removeProperty("--ai-visible-top");
  }
  function measure() {
    const reportedHeight = visibleViewport?.height;
    const height = Number.isFinite(reportedHeight) && reportedHeight > 0
      ? reportedHeight
      : window.innerHeight;
    const top = Math.max(0, visibleViewport?.offsetTop || 0);
    for (const [name, value] of [
      ["--ai-visible-height", height],
      ["--ai-visible-top", top],
    ]) {
      const pixels = value + "px";
      if (panel.style.getPropertyValue(name) !== pixels)
        panel.style.setProperty(name, pixels);
    }
  }
  function update(now) {
    frame = 0;
    if (lifetime.signal.aborted) return;
    if (!mobile.matches || panel.hidden) return clear();
    measure();
    if (now < settleUntil) frame = requestAnimationFrame(update);
  }
  function sync({ settle = false } = {}) {
    if (lifetime.signal.aborted) return;
    if (!mobile.matches || panel.hidden) return clear();
    measure();
    // A keyboard can finish resizing/panning after its last viewport event.
    // Recheck briefly after focus or geometry changes, without moving focus or
    // scrolling the page. Stop sampling once the transition has settled.
    if (settle) settleUntil = performance.now() + 1000;
    if (!frame) frame = requestAnimationFrame(update);
  }
  const settle = () => sync({ settle: true });
  const options = { signal: lifetime.signal, passive: true };
  visibleViewport?.addEventListener("resize", settle, options);
  visibleViewport?.addEventListener("scroll", settle, options);
  window.addEventListener("resize", settle, options);
  mobile.addEventListener("change", settle, options);
  prompt.addEventListener("focus", settle, options);
  prompt.addEventListener("blur", settle, options);

  return {
    sync,
    dispose() {
      lifetime.abort();
      clear();
    },
  };
}

import { createPanelViewport } from "./panel-viewport";

export function createPanelLayout({ panel, mobile }) {
  const lifetime = new AbortController();
  const viewport = createPanelViewport({ panel, mobile });
  const form = panel.querySelector("form");
  const composer = panel.querySelector(".saa-ai-composer");
  const prompt = panel.querySelector("textarea");
  const head = panel.querySelector(".saa-ai-head");
  const scroll = panel.querySelector("[data-scroll]");
  let frame, lastScroll = 0, distance = 0;

  function resizeComposer() {
    if (panel.hidden) return;
    const expanded = form.contains(document.activeElement);
    const previousScroll = prompt.scrollTop;
    composer.classList.toggle("is-expanded", expanded);
    prompt.style.height = expanded ? "0px" : "24px";
    if (expanded) {
      prompt.style.height = Math.max(24, Math.min(144, prompt.scrollHeight)) + "px";
      prompt.style.setProperty("--ai-scrollbar-size", (prompt.offsetWidth - prompt.clientWidth) + "px");
      prompt.scrollTop = previousScroll;
    } else {
      prompt.scrollTop = prompt.scrollLeft = 0;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!form.contains(document.activeElement)) prompt.scrollTop = prompt.scrollLeft = 0;
      });
    }
    panel.style.setProperty("--ai-composer-space", (form.hidden ? 0 : form.offsetHeight + 20) + "px");
  }
  function showHeader() {
    panel.classList.remove("saa-ai-head-hidden");
    head.inert = false;
    lastScroll = scroll.scrollTop;
    distance = 0;
  }
  scroll.addEventListener("scroll", () => {
    const current = Math.max(0, scroll.scrollTop), delta = current - lastScroll;
    if (delta * distance < 0) distance = 0;
    distance += delta;
    lastScroll = current;
    if (!mobile.matches || panel.classList.contains("saa-ai-history-mode")) return;
    if (current < 20 || distance < -8) showHeader();
    else if (distance > 8) {
      panel.classList.add("saa-ai-head-hidden");
      head.inert = true;
    }
  }, { passive: true, signal: lifetime.signal });
  form.addEventListener("focusin", resizeComposer, { signal: lifetime.signal });
  form.addEventListener("focusout", () => queueMicrotask(() => {
    if (!lifetime.signal.aborted) resizeComposer();
  }), { signal: lifetime.signal });
  // Moving the send button on pointerdown would lose the subsequent click,
  // and focusing it would unnecessarily dismiss the mobile keyboard.
  panel.querySelector(".saa-ai-send").addEventListener("pointerdown", event => {
    if (event.button === 0) event.preventDefault();
  }, { signal: lifetime.signal });
  panel.addEventListener("pointerdown", event => {
    if (!form.contains(event.target) && form.contains(document.activeElement)) {
      document.activeElement.blur();
      resizeComposer();
    }
  }, { signal: lifetime.signal });
  head.addEventListener("focusin", showHeader, { signal: lifetime.signal });
  mobile.addEventListener("change", showHeader, { signal: lifetime.signal });
  const observer = new ResizeObserver(resizeComposer);
  observer.observe(panel);
  observer.observe(form);
  return {
    resizeComposer,
    showHeader,
    syncViewport: viewport.sync,
    dispose() {
      lifetime.abort();
      observer.disconnect();
      viewport.dispose();
      cancelAnimationFrame(frame);
      head.inert = false;
    },
  };
}

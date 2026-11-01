"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

const ThemeContext = createContext(null);
const key = "saa-c03-theme";
const valid = (value) => ["system", "light", "dark"].includes(value);
const labels = { system: "시스템 설정", light: "라이트", dark: "다크" };
const paths = {
  system: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  dark: <path d="M20 14.4A8.5 8.5 0 0 1 9.6 4a8.5 8.5 0 1 0 10.4 10.4Z" />,
  check: <path d="m5 12 4 4L19 6" />,
};
function Icon({ name }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState("system");
  const [dark, setDark] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    const read = () => {
      try {
        const stored = localStorage.getItem(key);
        setPreference(valid(stored) ? stored : "system");
      } catch {}
    };
    const change = () => setDark(system.matches);
    const storage = (e) => {
      if (e.key === key || e.key === null) read();
    };
    read();
    change();
    setReady(true);
    system.addEventListener("change", change);
    window.addEventListener("storage", storage);
    return () => {
      system.removeEventListener("change", change);
      window.removeEventListener("storage", storage);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const theme =
      preference === "system" ? (dark ? "dark" : "light") : preference;
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.themePreference = preference;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "dark" ? "#171819" : "#182b44";
  }, [preference, dark, ready]);
  function choose(value) {
    try {
      localStorage.setItem(key, value);
    } catch {}
    setPreference(value);
  }
  return (
    <ThemeContext.Provider
      value={{
        preference,
        theme: preference === "system" ? (dark ? "dark" : "light") : preference,
        choose,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
export function ThemeToggle() {
  const { preference, theme, choose } = useContext(ThemeContext);
  const [open, setOpen] = useState(false);
  const control = useRef(null),
    toggle = useRef(null),
    menu = useRef(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    menu.current.querySelector('[aria-checked="true"]')?.focus();
    const outside = (e) => {
      if (!control.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("click", outside);
    return () => document.removeEventListener("click", outside);
  }, [open]);
  function close() {
    setOpen(false);
    toggle.current?.focus({ preventScroll: true });
  }
  function keyboard(e) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
      return;
    }
    if (e.key === "Tab") {
      if (open) close();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!open) {
      setOpen(true);
      return;
    }
    const items = [...menu.current.children],
      index = items.indexOf(document.activeElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? items.length - 1
          : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length;
    items[next].focus();
  }
  return (
    <div
      className="theme-control"
      data-theme-ui
      ref={control}
      onKeyDownCapture={keyboard}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        className="theme-toggle"
        ref={toggle}
        type="button"
        aria-haspopup="menu"
        aria-controls={id}
        aria-expanded={open}
        aria-label={`테마 설정: ${labels[preference]}${preference === "system" ? ` (${labels[theme]})` : ""}`}
        title="테마 설정"
        onClick={() => setOpen(!open)}
      >
        <Icon name={preference === "system" ? "system" : theme} />
      </button>
      <div
        id={id}
        ref={menu}
        className="theme-menu"
        role="menu"
        aria-label="화면 테마"
        hidden={!open}
      >
        {Object.keys(labels).map((choice) => (
          <button
            key={choice}
            type="button"
            tabIndex={-1}
            role="menuitemradio"
            aria-checked={preference === choice}
            data-theme-choice={choice}
            onClick={() => {
              choose(choice);
              close();
            }}
          >
            <Icon name={choice} />
            <span>{labels[choice]}</span>
            <span className="theme-check">
              <Icon name="check" />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

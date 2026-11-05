"use client";

import { memo, useId, useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

const plugins = [remarkGfm, remarkBreaks, remarkMath];
const rehypePlugins = [[rehypeKatex, {
  trust: false,
  strict: "ignore",
  errorColor: "currentColor",
  maxExpand: 1000,
  maxSize: 10,
}]];

function safeUrl(url) {
  const safe = defaultUrlTransform(url);
  // Keep ordinary web/mail links, local paths and footnotes. Never execute a
  // model-supplied protocol or load a remote image just by opening a message.
  return /^(?:https?:|mailto:)/i.test(safe) || !/^(?:[a-z][\w+.-]*:|\/\/)/i.test(safe) ? safe : "";
}
function MarkdownLink({ node, href, children, ...props }) {
  if (!href) return <span>{children}</span>;
  const fragment = href.startsWith("#");
  function followFootnote(event) {
    if (!fragment || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    let id;
    try { id = decodeURIComponent(href.slice(1)); } catch { return; }
    const target = event.currentTarget.closest(".saa-ai-markdown")?.querySelector(`#${CSS.escape(id)}`);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (target.matches("a[href]")) target.focus({ preventScroll: true });
  }
  return <a {...props} href={href} target={fragment ? undefined : "_blank"}
    rel={fragment ? undefined : "noopener noreferrer"} onClick={followFootnote}>{children}</a>;
}
const components = {
  a: MarkdownLink,
  // Render image references as explicit links rather than automatic downloads.
  img({ src, alt, title }) {
    return <MarkdownLink href={src} title={title}>{alt || "이미지 보기"}</MarkdownLink>;
  },
  table({ node, children, ...props }) {
    return <div className="saa-ai-markdown-table" role="region" aria-label="표" tabIndex={0}>
      <table {...props}>{children}</table>
    </div>;
  },
  pre({ node, children, ...props }) {
    return <pre {...props} tabIndex={0} aria-label="코드 블록">{children}</pre>;
  },
  span({ node, className, ...props }) {
    const displayMath = className?.split(" ").includes("katex-display");
    return <span {...props} className={className}
      {...(displayMath ? { role: "region", "aria-label": "수식", tabIndex: 0 } : {})} />;
  },
};

// Mounted by the browser-only chat slots. Finished messages skip parsing again
// when a later reply streams; the API payload and persisted text stay untouched.
export const ChatMarkdown = memo(function ChatMarkdown({ text }) {
  const id = useId();
  // GFM's shared label ID also needs a message-local name, like its footnotes.
  const messageComponents = useMemo(() => {
    const labelId = `saa-md-${id}-footnote-label`;
    return { ...components,
      h2({ node, id: headingId, ...props }) {
        return <h2 {...props} id={headingId === "footnote-label" ? labelId : headingId} />;
      },
      a(props) {
        return <MarkdownLink {...props} aria-describedby={props["aria-describedby"] === "footnote-label"
          ? labelId : props["aria-describedby"]} />;
      },
    };
  }, [id]);
  const options = useMemo(() => ({
    clobberPrefix: `saa-md-${id}-`,
    footnoteLabel: "각주",
    footnoteBackLabel: "본문으로 돌아가기",
  }), [id]);
  return <div className="saa-ai-markdown">
    <ReactMarkdown remarkPlugins={plugins} rehypePlugins={rehypePlugins} remarkRehypeOptions={options}
      components={messageComponents} urlTransform={safeUrl}>{text}</ReactMarkdown>
  </div>;
});

import { dumpsQuestionPath } from "./paths";

function textOf(element) {
  if (!element) return "";
  const clone = element.cloneNode(true);
  clone
    .querySelectorAll(
      "button,input,script,style,.feedback,.choice-status,.question-actions,.question-tags,.heading-link,.citation",
    )
    .forEach((node) => node.remove());
  clone
    .querySelectorAll("p,h1,h2,h3,li,section,div,label")
    .forEach((node) => node.append("\n"));
  return (clone.textContent || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
export function contextForItem(context, button) {
  if (context.source === "dumps") {
    const { q, note } = context;
    const reference = [
      "참고 답안 (오류 가능): " + (note.answerOverride || q.answer).join(", "),
      note.answerReview ? "원문 답안 검토가 필요한 문제입니다." : "",
      JSON.stringify(note),
      q.explanation || "",
    ]
      .join("\n")
      .slice(0, 2600);
    const text = [
      q.stem,
      ...q.options.map((o) => o.key + ". " + o.text),
      reference,
    ].join("\n");
    return {
      id: `dumps:${q.id}`,
      kind: "question",
      title: `문제 ${q.id}`,
      text: text.slice(0, 12000),
      hasImages:
        /\[\[?(?:image|img)|<img|data:image|\{\{image/i.test(text) ||
        !!button.closest(".question")?.querySelector(".qbody img"),
    };
  }
  if (context.source === "quiz") {
    const card = button.closest("[data-question]");
    return {
      id: `quiz:${card.dataset.question}`,
      kind: "question",
      title: `퀴즈 ${Number(card.dataset.question.slice(1))}`,
      text: [
        textOf(card.querySelector("h3")),
        textOf(card.querySelector("fieldset")),
        "참고 답안과 해설 (오류 가능):",
        textOf(card.querySelector(".explanation")),
      ]
        .join("\n")
        .slice(0, 12000),
      hasImages: !!card.querySelector("img"),
    };
  }
  const article = button.closest(".term-article");
  const references = [...article.querySelectorAll('a[href^="https://"]')]
    .map((a) => a.href)
    .filter((value, i, all) => all.indexOf(value) === i)
    .slice(0, 8)
    .join("\n");
  return {
    id: `concept:${context.key}`,
    kind: "concept",
    title: textOf(article.querySelector("h1")).slice(0, 180),
    text:
      textOf(article).slice(0, 10500) +
      "\n공식 참고 문서:\n" +
      references.slice(0, 1400),
    hasImages: !!article.querySelector("img"),
  };
}

export function contextSourceHref(context) {
  const dumps = /^dumps:([1-9]\d*)$/.exec(context.id);
  if (dumps) return `${dumpsQuestionPath(dumps[1])}#question-title`;
  const quiz = /^quiz:Q(\d{3})$/.exec(context.id);
  if (quiz) return `/concepts/quiz/q${quiz[1]}/#question-Q${quiz[1]}`;
  const concept = /^concept:\/terms\/([a-z0-9-]+)\.html$/.exec(context.id);
  if (concept) return `/concepts/terms/${concept[1]}/#concept-title`;
  return null;
}

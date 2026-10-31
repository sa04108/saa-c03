"use client";
import { useEffect, useRef, useState } from "react";
import { AIButton } from "./assistant/ai-button";
const storageKey = "saa-c03-site-answers-v1";
export function ConceptQuiz({
  id,
  revision,
  correct,
  number,
  type,
  question,
  options,
  explanation,
  tags,
  link,
}) {
  const [selected, setSelected] = useState([]),
    [graded, setGraded] = useState(false),
    [feedback, setFeedback] = useState("");
  const details = useRef(null);
  const expected = correct
    .split(",")
    .map(Number)
    .sort((a, b) => a - b);
  const right =
    selected.length === expected.length &&
    selected.every((v, i) => v === expected[i]);
  useEffect(() => {
    try {
      const all = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
      const item = all[id];
      if (item && (item.revision || 1) !== revision) {
        delete all[id];
        localStorage.setItem(storageKey, JSON.stringify(all));
      } else if (item && Array.isArray(item.selected)) {
        setSelected([...item.selected].sort((a, b) => a - b));
        setGraded(!!item.graded);
      }
    } catch {}
  }, [id, revision]);
  function save(values, checked, reset = false) {
    setSelected(values);
    setGraded(checked);
    setFeedback("");
    try {
      const all = JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
      if (reset) delete all[id];
      else all[id] = { selected: values, graded: checked, revision };
      localStorage.setItem(storageKey, JSON.stringify(all));
    } catch {}
  }
  return (
    <article
      className={`question-card${graded ? (right ? " is-correct" : " is-wrong") : ""}`}
      id={`question-${id}`}
      data-question={id}
      data-revision={revision}
      data-correct={correct}
    >
      <div className="question-top">
        <span className="question-no">{number}</span>
        <span className="type-label">{type}</span>
        {link}
        <AIButton context={{ source: "quiz" }} />
      </div>
      <h3 lang="en">{question}</h3>
      <fieldset>
        <legend>정답을 선택하세요</legend>
        {options.map((option, index) => (
          <label className="option" key={index}>
            <input
              type={expected.length > 1 ? "checkbox" : "radio"}
              name={`answer-${id}`}
              value={index}
              checked={selected.includes(index)}
              onChange={(e) => {
                const values =
                  expected.length === 1
                    ? [index]
                    : e.target.checked
                      ? [...selected, index]
                      : selected.filter((v) => v !== index);
                save(
                  values.sort((a, b) => a - b),
                  false,
                );
                details.current.open = false;
              }}
            />
            <span className="option-letter">
              {String.fromCharCode(65 + index)}
            </span>
            <span lang="en">{option}</span>
          </label>
        ))}
      </fieldset>
      <div className="question-actions">
        <button
          className="check-answer"
          type="button"
          onClick={() => {
            if (!selected.length) {
              setFeedback("선택지를 먼저 고르세요.");
              return;
            }
            save(selected, true);
            details.current.open = true;
          }}
        >
          채점하기
        </button>
        <button
          className="reset-answer"
          type="button"
          onClick={() => {
            save([], false, true);
            details.current.open = false;
          }}
        >
          선택 지우기
        </button>
        <span className="feedback" role="status" aria-live="polite">
          {feedback ||
            (graded ? (right ? "정답입니다." : "다시 확인해 보세요.") : "")}
        </span>
      </div>
      <details className="explanation" ref={details}>
        <summary>정답과 해설</summary>
        {explanation}
      </details>
      {tags}
    </article>
  );
}

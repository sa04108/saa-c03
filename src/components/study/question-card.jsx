"use client";
import { AIButton } from "../assistant/ai-button";

export function RichText({ text, images }) {
  return String(text)
    .split(/(\[\[img\d+\]\])/g)
    .map((part, i) => {
      const key = /^\[\[(img\d+)\]\]$/.exec(part)?.[1];
      return key ? (
        images[key] ? (
          <img
            key={i}
            className="source-img"
            src={images[key]}
            alt="문제 원본의 정책 또는 선택지 이미지"
            loading="lazy"
            decoding="async"
          />
        ) : null
      ) : (
        part.split("\n").map((line, j) => (
          <span key={`${i}-${j}`}>
            {j > 0 && <br />}
            {line}
          </span>
        ))
      );
    });
}
function Explanation({ q, note }) {
  const text = q.explanation || q.solution;
  return (
    <>
      <div className="gpt-notes">
        {[
          ["explanation", "ChatGPT explanation"],
          ["correction", "ChatGPT correction"],
        ]
          .filter(([key]) => note[key])
          .map(([key, title]) => (
            <section
              key={key}
              className={`gpt-note ${key}`}
              aria-labelledby={`gpt-${key}-title`}
            >
              <h3 id={`gpt-${key}-title`} lang="en">
                {title}
              </h3>
              <p lang="en">{note[key]}</p>
            </section>
          ))}
        {note.references?.length > 0 && (
          <nav className="gpt-references" aria-label="해설 참고 자료">
            {note.references.map((ref) => (
              <a
                key={ref.url}
                href={ref.url}
                target="_blank"
                rel="noopener noreferrer"
                lang="en"
              >
                {ref.label} ↗
              </a>
            ))}
          </nav>
        )}
      </div>
      {!text ? (
        <p className="muted">
          제공된 TXT에 이 문제의 해설이 수록되어 있지 않습니다.
        </p>
      ) : note.sourceAnswerOnly ? (
        <details className="source-details">
          <summary>원문 문제·답안 보기</summary>
          <pre lang="en">{text}</pre>
        </details>
      ) : (
        <>
          <div className="source-explanation">
            <h3>원문 답안과 해설</h3>
            <pre lang="en">{text}</pre>
          </div>
          {q.solution && q.solution !== q.explanation && (
            <details className="source-details">
              <summary>이 문제의 TXT 원문 전체</summary>
              <pre lang="en">{q.solution}</pre>
            </details>
          )}
        </>
      )}
    </>
  );
}
export function QuestionCard({ view, images, actions }) {
  const { q, record: r, note, result, answer, gradable } = view;
  if (!q)
    return (
      <section className="panel empty">
        <h2>해당하는 문제가 없습니다</h2>
        <p className="muted">학습 범위나 검색어를 바꿔 보세요.</p>
        <button
          id="show-all"
          className="primary"
          onClick={() => actions.filter("all", "")}
        >
          전체 문제 보기
        </button>
      </section>
    );
  return (
    <article className="panel question" id={`question-${q.id}`} aria-labelledby="question-title">
      <header className="qhead">
        <div className="qtitle">
          <h2 id="question-title" tabIndex={-1}>
            문제 {String(q.id).padStart(3, "0")}
          </h2>
          <span className="badge">
            {q.count > 1 ? `${q.count}개 선택` : "단일 선택"}
          </span>
        </div>
        <div className="saa-ai-actions">
          <button
            className="flag"
            id="flag"
            aria-pressed={r.flagged}
            onClick={actions.flag}
          >
            {r.flagged ? "★ 별표" : "☆ 별표"}
          </button>
          <AIButton context={{ source: "dumps", q, note }} />
        </div>
      </header>
      <div className="qbody">
        {q.notice && <p className="notice">{q.notice}</p>}
        <div className="stem" lang="en">
          <RichText text={q.stem} images={images} />
        </div>
        <p className="choice-hint">
          {r.checked
            ? "선택 결과를 확인하세요."
            : `${q.count}개의 답을 선택한 후 정답을 확인하세요.`}
        </p>
        <fieldset className="choices">
          <legend className="sr-only">{q.count}개의 답 선택</legend>
          {q.options.map((o) => {
            const selected = r.selected.includes(o.key),
              correct = r.checked && gradable && answer.includes(o.key),
              wrong = r.checked && gradable && selected && !correct;
            return (
              <button
                type="button"
                key={o.key}
                className={`option ${selected ? "selected " : ""}${correct ? "correct " : ""}${wrong ? "wrong " : ""}`}
                data-option={o.key}
                aria-pressed={selected}
                disabled={r.checked}
                onClick={() => actions.select(o.key)}
              >
                <span className="letter">{o.key}</span>
                <span className="option-content" lang="en">
                  <RichText text={o.text} images={images} />
                  {r.checked && (correct || selected) && (
                    <span className="choice-status" lang="ko">
                      {correct ? "✓ 정답" : ""}
                      {selected
                        ? correct
                          ? " · 내 선택"
                          : gradable
                            ? "✕ 내 선택"
                            : "내 선택"
                        : ""}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </fieldset>
      </div>
      <div className="qactions">
        <span className="small muted">
          {r.checked
            ? `선택: ${r.selected.join(", ") || "없음"}`
            : `선택 ${r.selected.length} / ${q.count}`}
        </span>
        {r.checked ? (
          <button id="retry" onClick={actions.retry}>
            이 문제 다시 풀기
          </button>
        ) : (
          <button
            id="check"
            className="primary"
            disabled={gradable && r.selected.length !== q.count}
            onClick={actions.check}
          >
            {gradable ? "정답 · 해설 확인" : "답안 · 해설 보기"}
          </button>
        )}
      </div>
      {r.checked && (
        <section className="explanation" aria-label="채점 결과와 해설">
          <div className={`result-title ${result}`} role="status">
            {result === "correct"
              ? "정답입니다."
              : result === "wrong"
                ? "다시 살펴볼 문제입니다."
                : note.answerReview
                  ? "답안 검토가 필요한 문제입니다."
                  : q.answerStatus === "ambiguous"
                    ? "TXT의 정답 표기가 불명확합니다."
                    : "제공 TXT에 답안이 없습니다."}
          </div>
          <div>
            {gradable ? (
              <>
                정답 <strong>{answer.join(", ")}</strong> · 내 선택{" "}
                {r.selected.join(", ")}
              </>
            ) : (
              "이 문제는 자동채점에서 제외합니다. 아래 해설과 원문을 함께 확인하세요."
            )}
          </div>
          <p className="answer-source">
            {note.answerOverride
              ? `정정 답안으로 채점합니다. 원문 답안: ${q.answer.join(", ")}.`
              : note.answerReview
                ? (q.answer.length
                    ? `원문 답안: ${q.answer.join(", ")}. `
                    : "") +
                  "답안을 검토 중이므로 정답·오답 수에 포함하지 않습니다."
                : "원문 답안을 기준으로 표시합니다."}
          </p>
          <Explanation q={q} note={note} />
        </section>
      )}
    </article>
  );
}

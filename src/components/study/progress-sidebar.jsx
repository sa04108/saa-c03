"use client";
export function ProgressSidebar({ view, actions, expanded, setExpanded, go }) {
  const state = view?.state;
  return (
    <aside
      className={`side panel${expanded ? " expanded" : ""}`}
      id="sidebar"
      aria-label="학습 현황과 문제 목록"
    >
      <span className="eyebrow">Your progress</span>
      <div className="progress-title">
        <div>
          <strong id="done">{view?.reviewed || 0}</strong>{" "}
          <span>/ 684문제</span>
        </div>
        <span id="percent">
          {Math.round(((view?.reviewed || 0) / 684) * 100)}%
        </span>
      </div>
      <progress
        id="progress"
        max="684"
        value={view?.reviewed || 0}
        aria-label="확인한 문제 수"
      />
      <div className="stats">
        <div>
          <strong id="right">{view?.correct || 0}</strong>정답
        </div>
        <div>
          <strong id="wrong">{view?.wrong || 0}</strong>오답
        </div>
        <div>
          <strong id="remaining">{view?.remaining ?? 684}</strong>미완료
        </div>
      </div>
      <button
        className="mobile-map"
        id="toggle-map"
        aria-expanded={expanded}
        aria-controls="map-wrap"
        onClick={() => setExpanded(!expanded)}
      >
        <span>문제 찾기 · 이동</span>
        <span aria-hidden="true">☰</span>
      </button>
      <div className="map-wrap" id="map-wrap">
        <hr className="divider" />
        <label className="field-label" htmlFor="filter">
          학습 범위
        </label>
        <select
          id="filter"
          value={state?.filter || "all"}
          onChange={(e) => actions?.filter(e.target.value)}
        >
          <option value="all">전체 문제</option>
          <option value="unanswered">미채점 문제</option>
          <option value="wrong">틀린 문제</option>
          <option value="flagged">별표 문제</option>
          <option value="missing">답안 확인 필요</option>
        </select>
        <label className="field-label" htmlFor="search">
          내용 검색
        </label>
        <input
          id="search"
          type="search"
          placeholder="예: Amazon S3"
          autoComplete="off"
          value={state?.query || ""}
          onChange={(e) => actions?.search(e.target.value)}
        />
        <form
          className="jump"
          id="jump-form"
          onSubmit={(e) => {
            e.preventDefault();
            go(Number(e.currentTarget.elements.jump.value), true);
          }}
        >
          <label className="sr-only" htmlFor="jump">
            문제 번호
          </label>
          <input
            id="jump"
            name="jump"
            type="number"
            min="1"
            max="684"
            inputMode="numeric"
            placeholder="번호 1–684"
            required
          />
          <button type="submit">이동</button>
        </form>
        <hr className="divider" />
        <div className="map-pager">
          <button
            id="map-prev"
            aria-label="이전 문제 목록"
            disabled={!view || view.mapPage === 0}
            onClick={() => actions.page(-1)}
          >
            ‹
          </button>
          <span id="map-range" className="small">
            {view?.ids.length
              ? `${view.mapPage * 40 + 1}–${Math.min((view.mapPage + 1) * 40, view.ids.length)} / ${view.ids.length}`
              : "0문제"}
          </span>
          <button
            id="map-next"
            aria-label="다음 문제 목록"
            disabled={!view || view.mapPage >= view.pages - 1}
            onClick={() => actions.page(1)}
          >
            ›
          </button>
        </div>
        <nav className="navigator" id="navigator" aria-label="문제 번호 목록">
          {view?.map.map((q) => (
            <button
              key={q.id}
              className={`qnum ${q.result}${q.id === state.current ? " current" : ""}${q.flagged ? " flagged" : ""}`}
              data-go={q.id}
              aria-label={`${q.id}번, ${{ unanswered: "미응답", draft: "선택 중", correct: "정답", wrong: "오답", viewed: "답안 열람" }[q.result]}${q.flagged ? ", 별표" : ""}`}
              aria-current={q.id === state.current ? "true" : undefined}
              onClick={() => go(q.id)}
            >
              {q.id}
            </button>
          ))}
        </nav>
        <div className="legend">
          초록: 정답 · 빨강: 오답 · 파랑: 선택 중<br />★ 다시 볼 문제 · 테두리:
          현재 문제
        </div>
      </div>
    </aside>
  );
}

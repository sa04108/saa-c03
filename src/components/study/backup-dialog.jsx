"use client";
import { useState } from "react";
import { exportJSON, exportHTML } from "@/lib/study/backup";

export function BackupDialog({ dialog, view, actions, notify }) {
  const [exporting, setExporting] = useState(false),
    [protection, setProtection] = useState("");
  async function html() {
    setExporting(true);
    try {
      await exportHTML(actions.exportState());
      notify("진행 상태가 포함된 HTML을 다운로드합니다.");
    } catch {
      notify("HTML을 다운로드하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setExporting(false);
    }
  }
  async function restore(event) {
    const input = event.currentTarget,
      file = input.files[0];
    if (!file) return;
    try {
      if (file.size > 5 * 1024 * 1024) throw Error("Too large");
      const imported = actions.validate(JSON.parse(await file.text()));
      if (
        !confirm(
          `백업의 ${Object.keys(imported.records).length}개 문제 기록으로 현재 진행 상태를 교체할까요? 현재 기록이 필요하면 먼저 백업하세요.`,
        )
      )
        return;
      actions.importState(imported);
      notify("백업을 불러왔습니다.");
      dialog.current.close();
    } catch {
      notify("이 문제집에서 만든 올바른 JSON 백업 파일을 선택하세요.");
    } finally {
      input.value = "";
    }
  }
  async function protect() {
    try {
      if (!navigator.storage?.persist) {
        setProtection(
          "이 실행 환경에서는 지원되지 않습니다. 백업 파일을 사용하세요.",
        );
        return;
      }
      setProtection(
        (await navigator.storage.persist())
          ? "보호가 적용되었습니다. 직접 사이트 데이터를 삭제하면 기록은 지워집니다."
          : "Chrome이 현재 보호를 허용하지 않았습니다. 일반 자동저장은 계속 사용하며, 주기적으로 백업하세요.",
      );
    } catch {
      setProtection("보호를 요청할 수 없습니다. 백업 파일을 사용하세요.");
    }
  }
  return (
    <dialog ref={dialog} id="settings" aria-labelledby="settings-title">
      <div className="row between">
        <h2 id="settings-title">저장과 이어풀기</h2>
        <button
          className="close"
          id="close-settings"
          aria-label="닫기"
          onClick={() => dialog.current.close()}
        >
          ✕
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 15 }}>
        로그인하면 선택한 답, 채점 결과, 별표와 마지막 문제를 계정에 저장합니다.
        로그인 없이 이용하면 현재 기기와 브라우저에 저장합니다.
      </p>
      <p id="account-info" className="small muted">
        {view?.accountInfo}
      </p>
      <button
        id="import-guest"
        type="button"
        hidden={!view?.hasGuest}
        onClick={() => {
          if (
            !confirm(
              "이 기기에 저장된 기존 진도로 계정 진도를 교체할까요? 필요하면 현재 계정 기록을 먼저 백업하세요.",
            )
          )
            return;
          actions.importGuest();
          dialog.current.close();
          notify("기기 기록을 계정에 저장합니다.");
        }}
      >
        이 기기의 기존 기록 가져오기
      </button>
      <h3>진행 상태 백업</h3>
      <div className="actions">
        <button
          id="export-json"
          className="primary"
          onClick={() => {
            exportJSON(actions.exportState());
            notify("백업 파일을 다운로드합니다.");
          }}
        >
          백업 JSON 저장
        </button>
        <button id="export-html" disabled={exporting} onClick={html}>
          진행 포함 HTML 저장
        </button>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        JSON은 다른 기기에 가져올 때, HTML은 문제와 진행 상태를 한 파일로 보관할
        때 사용하세요.
      </p>
      <h3>백업 불러오기</h3>
      <label className="file-label">
        이 문제집에서 저장한 JSON 파일
        <input
          id="import-json"
          type="file"
          accept=".json,application/json"
          onChange={restore}
        />
      </label>
      <h3>모바일 Chrome에서 사용하기</h3>
      <ul>
        <li>
          이 문제집을 Chrome의 일반 탭에서 열고, 같은 브라우저와 사이트 주소로
          다시 접속하세요.
        </li>
        <li>
          다운로드한 HTML도 인터넷 없이 풀 수 있습니다. 다만 파일 위치나 여는
          앱이 바뀌면 자동저장 기록을 찾지 못할 수 있습니다.
        </li>
        <li>
          시크릿 모드, 사이트 데이터 삭제, 브라우저 초기화로 기록이 사라질 수
          있습니다. 중요한 진도는 백업하세요.
        </li>
        <li>
          다른 기기에서는 같은 GitHub 계정으로 로그인하세요. 로그인 없이 이용한
          기록은 백업 JSON으로 옮길 수 있습니다.
        </li>
      </ul>
      <button id="persist" style={{ width: "100%" }} onClick={protect}>
        자동 정리로부터 저장 데이터 보호 요청
      </button>
      <p id="persist-result" className="small muted" style={{ marginTop: 8 }}>
        {protection}
      </p>
      <hr className="divider" />
      <h3>원본 자료 확인</h3>
      <p id="source-summary" className="small muted">
        {view &&
          `전체 684문제 · 답안 연결 ${684 - view.missing.length}문제 · 답안 확인 필요 ${view.missing.length}문제 · 원본 이미지 ${view.imageCount}개`}
      </p>
      <p className="small muted">
        125번: PDF의 마지막 D 선택지를 E로 표시했습니다.
        <br />
        315번: TXT에서 중복된 215번을 문제 내용으로 연결했습니다.
      </p>
      <details>
        <summary className="small">답안 확인이 필요한 문제 번호</summary>
        <p id="missing-list" className="small muted" style={{ marginTop: 10 }}>
          {view?.missing.join(", ")}
        </p>
      </details>
      <hr className="divider" />
      <button
        id="reset"
        className="danger"
        onClick={() => {
          if (
            !confirm(
              "684문제의 선택, 채점, 별표 기록을 모두 초기화할까요? 필요하면 먼저 백업하세요.",
            )
          )
            return;
          actions.reset();
          dialog.current.close();
          notify("진행 상태를 초기화했습니다.");
        }}
      >
        전체 진행 상태 초기화
      </button>
    </dialog>
  );
}

# SAA-C03 학습 자료

빌드나 서버 없이 실행하는 정적 웹사이트입니다.

- `/concepts/`: 개념 위키와 개념별 문제 풀이
- `/dumps/`: 684문제 문제집
- `/`: 두 페이지로 이동하는 시작 화면

GitHub Pages 프로젝트 사이트에서는 저장소 이름이 앞에 붙습니다.

- `https://sa04108.github.io/saa-c03/concepts/`
- `https://sa04108.github.io/saa-c03/dumps/`

페이지 사이의 이동은 상대 경로를 사용하므로 다른 저장소 이름이나 사용자 지정 도메인에서도 동작합니다. 개념 위키 내부의 개념·문제 이동은 기존 해시 경로를 사용합니다.

## GitHub Pages 배포

1. 저장소의 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.
2. `devel`의 변경을 검토한 뒤 `main`에 병합합니다. 아직 `main`이 없는 빈 저장소라면 검토 후 `devel`에서 `main` 브랜치를 생성합니다.
3. **Actions → Deploy GitHub Pages**의 배포가 완료되면 위 주소로 접속합니다.

워크플로는 `main`에 푸시할 때 배포합니다. `devel`은 검토용이며 배포하지 않습니다. `main`에서 수동으로 워크플로를 실행해 다시 배포할 수도 있습니다. 실제 공개 배포는 저장소의 Pages 사용 가능 여부와 설정에 따릅니다.

## 풀이 기록

로그인과 서버 통신 없이 브라우저의 `localStorage`와 `IndexedDB`에 저장합니다. 문제집은 선택한 답, 채점 결과, 별표, 마지막 문제, 학습 범위와 검색어를 복원합니다. 같은 사이트에서 열린 탭 간에는 `localStorage` 변경을 반영합니다.

기록은 **기기·브라우저·사이트 주소별**로 유지됩니다. 다른 기기나 브라우저와 자동으로 공유되지 않으며, 시크릿 모드 종료나 사이트 데이터 삭제로 지워질 수 있습니다. 사이트 주소 또는 도메인을 변경하기 전에는 백업하세요.

문제집의 **저장 · 백업** 메뉴에서 JSON 백업을 저장하거나 불러올 수 있고, 문제와 현재 진도를 포함한 독립 실행 HTML을 다운로드할 수도 있습니다. 두 저장소 모두 사용할 수 없으면 백업이 필요하다는 안내를 표시합니다.

## 로컬 확인

저장소 루트에서 실행합니다. 애플리케이션 의존성은 없습니다.

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

브라우저에서 서버의 `/concepts/`, `/dumps/` 경로를 확인합니다.

## 브라우저 테스트

```sh
python3 -m venv /tmp/saa-c03-tests
/tmp/saa-c03-tests/bin/pip install -r requirements-dev.txt
/tmp/saa-c03-tests/bin/python -m playwright install chromium
/tmp/saa-c03-tests/bin/python -m unittest discover -s tests -v
```

시스템 Chromium이 있으면 자동으로 사용합니다. 다른 실행 파일은 `CHROMIUM_PATH`로 지정할 수 있습니다. 테스트는 별도의 임시 브라우저 프로필을 사용합니다.

# GitHub Actions 자동 배포

`main`에 push되면 **Supabase DB 마이그레이션 → `study-assistant` Edge Function → GitHub Pages** 순서로 배포합니다. `devel`에서는 운영 배포를 실행하지 않습니다.

## 최초 한 번 설정

[저장소의 Actions Secrets 설정](https://github.com/sa04108/saa-c03/settings/secrets/actions)에서 **New repository secret**으로 다음 두 값을 등록합니다.

| 이름 | 등록할 값 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | [Supabase 계정의 Access Tokens](https://supabase.com/dashboard/account/tokens)에서 생성한 개인 액세스 토큰. 운영 프로젝트에 접근 가능한 계정의 토큰을 사용합니다. Publishable key나 `service_role` 키가 아닙니다. |
| `SUPABASE_DB_PASSWORD` | 해당 Supabase 프로젝트의 Postgres 데이터베이스 비밀번호. 프로젝트 생성 시 정한 값이며, 모르면 Supabase 프로젝트의 Database 설정에서 재설정합니다. |

값은 저장소 파일이나 채팅에 적지 않습니다. 현재 GitHub 연결에는 Secrets 관리 권한이 없어 이 등록은 저장소 관리자가 직접 해야 합니다. 두 값은 배포 스크립트 단계에서만 사용하며 Pages 파일에 포함하지 않습니다.

배포 대상 프로젝트 ID는 공개 설정인 [`assets/account-config.js`](../assets/account-config.js)의 URL에서 읽습니다. 현재 대상은 `ngohlplwutssofoxobrj`입니다. 별도의 프로젝트 ID Secret은 필요하지 않습니다.

`GEMINI_API_KEY`, `TAVILY_API_KEY`, `ALLOWED_ORIGINS` 등은 기존처럼 **Supabase → Edge Functions → Secrets**에 둡니다. 함수 재배포 시 유지되므로 GitHub에 다시 등록할 필요가 없습니다. OAuth·익명 로그인 설정 역시 기존 Supabase 설정을 사용합니다.

두 Secrets를 등록한 뒤 `devel`을 `main`에 병합하면 첫 자동 배포가 시작됩니다. 실행 결과는 [Actions](https://github.com/sa04108/saa-c03/actions/workflows/pages.yml)에서 확인합니다.

## SQL Editor에서 적용한 기존 이력 연결

현재 프로젝트는 운영자가 `202610310005_delete_chat_history.sql`까지 성공적으로 적용했다고 확인한 상태입니다. 총 6개 파일의 목록과 해시는 [수동 적용 기준 파일](../.github/supabase-manual-baseline.json)에 고정했습니다.

첫 배포에서 Supabase CLI의 마이그레이션 이력이 비어 있거나 일부 누락되었다면 다음 순서로 처리합니다.

1. 운영 프로젝트 ID와 기존 이력을 확인합니다.
2. DB의 테이블·컬럼·함수 본문·권한·트리거 등이 005까지 적용된 상태인지 읽기 전용으로 확인합니다. 학습 진도나 대화 본문은 조회하지 않습니다.
3. 확인된 6개 파일 중 **이력에 없는 버전만** `migration repair --status applied`로 등록합니다. 해당 SQL 본문을 다시 실행하지 않습니다.
4. `db push --dry-run` 후 `db push`로 아직 적용하지 않은 새 마이그레이션을 실행합니다.

따라서 이미 있는 `turn_seq`를 다시 추가하지 않으며, 기존 진도·대화·캐시를 초기화하지 않습니다. 다음 배포부터는 등록된 이력을 사용합니다. 다른 프로젝트나 불완전한 DB는 자동으로 적용 완료 처리하지 않고 중단합니다.

`Database does not match the complete 005 baseline` 오류가 나면 로그의 대상 객체와 실제 DB 상태를 확인합니다. 오류를 없애려고 이미 적용한 SQL 전체를 다시 실행하거나 이력을 무조건 등록하지 않습니다. 특히 기존 002는 캐시를 초기화하고, 004는 컬럼 추가와 대화 순번 부여를 포함합니다.

## 이후 변경 방법

- 함수 변경: `supabase/functions/study-assistant/index.ts`를 수정하고 `main`에 반영합니다. Dashboard 편집기에 붙여 넣을 필요가 없습니다.
- DB 변경: `supabase/migrations/`에 기존 버전보다 뒤에 정렬되는 고유한 숫자 버전의 **새 SQL 파일**을 추가합니다. `supabase migration new <이름>`으로 생성해도 됩니다. 이미 적용한 파일은 수정하거나 삭제하지 않습니다.
- 화면 변경: 기존처럼 `main`에 반영하면 서버 배포 성공 후 Pages가 갱신됩니다.

함수는 CLI의 API 배포 방식으로 올려 Docker가 필요하지 않습니다. `verify_jwt = false` 설정은 유지하며, 함수 자체에서 Supabase Auth로 사용자의 Bearer 토큰을 검증합니다.

## 실패와 재실행

DB 또는 함수 배포가 실패하면 Pages 배포를 진행하지 않습니다. 원인을 수정한 뒤 Actions에서 실패한 실행을 다시 실행하거나, **Run workflow → main**으로 배포할 수 있습니다. 동시에 두 배포가 DB를 변경하지 않도록 같은 워크플로의 배포를 직렬화합니다.

DB·함수·Pages는 하나의 트랜잭션이 아닙니다. 함수 배포에서 실패해도 앞서 성공한 DB 변경은 남습니다. 재실행 시 CLI는 적용 완료된 SQL을 건너뛰며 자동으로 DB를 되돌리지 않습니다. 새 SQL은 기존에 배포된 함수·화면과 함께 동작하도록 작성하고, 실패한 파일이 부분 적용되었다면 실제 상태부터 확인합니다.

초기 설정에는 `supabase link`, DB 연결과 Supabase Management API 접근이 필요합니다. 토큰·DB 비밀번호가 바뀌면 해당 GitHub Secret도 갱신합니다. 네트워크 제한을 설정한 프로젝트는 Actions 러너에서의 접속도 허용해야 합니다.

현재 작업 환경에서는 배포 자격 증명 없이 로컬 검증을 수행했습니다. 실제 운영 배포 결과는 Secrets 등록 후 첫 `main` 실행에서 확인합니다.

참고: [DB push](https://supabase.com/docs/reference/cli/supabase-db-push), [migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair), [함수 배포](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

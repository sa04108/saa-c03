# GitHub Actions 자동 배포

`main`에 push되면 **Supabase DB 마이그레이션 → `study-assistant` Edge Function → GitHub Pages** 순서로 배포합니다. `devel`에서는 운영 배포를 실행하지 않습니다.

## 최초 한 번 설정

[저장소의 Actions Secrets 설정](https://github.com/sa04108/saa-c03/settings/secrets/actions)에서 **New repository secret**으로 다음 두 값을 등록합니다.

| 이름 | 등록할 값 |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | [Supabase 계정의 Access Tokens](https://supabase.com/dashboard/account/tokens)에서 생성한 개인 액세스 토큰. 운영 프로젝트에 접근 가능한 계정의 토큰을 사용합니다. Publishable key나 `service_role` 키가 아닙니다. |
| `SUPABASE_DB_PASSWORD` | 해당 Supabase 프로젝트의 Postgres 데이터베이스 비밀번호. 프로젝트 생성 시 정한 값이며, 모르면 Supabase 프로젝트의 Database 설정에서 재설정합니다. |

값은 저장소 파일이나 채팅에 적지 않습니다. 두 값은 배포 스크립트 단계에서만 사용하며 Pages 파일에 포함하지 않습니다. 현재 운영 저장소는 Secrets 등록과 자동 배포를 완료했으므로 다시 등록할 필요가 없습니다.

배포 대상 프로젝트 ID는 공개 설정인 [`assets/account-config.js`](../assets/account-config.js)의 URL에서 읽습니다. 현재 대상은 `ngohlplwutssofoxobrj`입니다. 별도의 프로젝트 ID Secret은 필요하지 않습니다.

`GEMINI_API_KEY`, `TAVILY_API_KEY`, `ALLOWED_ORIGINS` 등은 기존처럼 **Supabase → Edge Functions → Secrets**에 둡니다. 함수 재배포 시 유지되므로 GitHub에 다시 등록할 필요가 없습니다. OAuth·익명 로그인 설정 역시 기존 Supabase 설정을 사용합니다.

새 환경에서는 두 Secrets와 공개 연결 정보를 설정한 뒤 `devel`을 `main`에 병합합니다. 실행 결과는 [Actions](https://github.com/sa04108/saa-c03/actions/workflows/pages.yml)에서 확인합니다.

## 통합 초기 스키마와 기존 운영 이력

기존 6개 마이그레이션을 [202610310005_initial_schema.sql](../supabase/migrations/202610310005_initial_schema.sql) 하나로 통합했습니다. 과거 변경 명령을 이어 붙이지 않고 최종 테이블·함수·인덱스·RLS·권한·트리거를 정의합니다. 빈 Supabase 프로젝트에는 이 파일을 한 번 적용하면 됩니다.

운영 프로젝트에는 기존 6개 SQL이 모두 적용되어 있고, GitHub Actions 배포도 성공한 상태입니다. 이미 적용된 마지막 버전 `202610310005`를 통합 파일의 버전으로 유지합니다. **운영 DB에 통합 SQL을 다시 실행하지 않습니다.**

다음 `main` 배포에서 배포 스크립트는 기존 이력을 읽고, 제거된 5개 버전과 마지막 버전이 모두 확인된 경우에만 다음 명령으로 이력을 통합합니다.

```sh
supabase migration squash --linked --version 202610310005 --yes
```

해당 버전까지 로컬 SQL은 이미 한 파일이므로 CLI는 스키마 생성·실행을 생략하고, **마이그레이션 이력 6행을 1행으로 원자적으로 교체**합니다. 사용자 진도·대화·요약·캐시·모델 제외 상태는 건드리지 않습니다. 통합 이후 버전의 이력도 유지합니다. 이력 정리 결과를 확인한 뒤 `db push --dry-run`, `db push`, 함수 배포를 진행합니다. 다음 배포나 실패 후 재실행에서는 이미 정리된 이력을 그대로 사용합니다.

새 프로젝트처럼 이력이 비어 있으면 이력 통합을 생략하고 통합 초기 SQL을 정상 실행합니다. 기존 이력이 일부만 있거나 저장소에 없는 알 수 없는 버전이 있으면 중단합니다. 과거 SQL Editor 설치를 스키마 비교로 추정해 적용 완료 처리하는 기능은 제거했습니다.

`Remote migration history is incomplete or unknown` 오류가 나면 `supabase migration list --linked`로 실제 이력부터 확인합니다. 일부만 설치된 구형 DB에 초기 스키마를 덮어쓰거나 적용하지 않은 버전을 완료로 등록하지 않습니다. 통합 전 SQL이 필요한 경우 Git의 통합 전 커밋에서 확인할 수 있습니다.

## 이후 변경 방법

- 함수 변경: `supabase/functions/study-assistant/index.ts`를 수정하고 `main`에 반영합니다. Dashboard 편집기에 붙여 넣을 필요가 없습니다.
- DB 변경: 통합 초기 SQL은 그대로 두고 `supabase/migrations/`에 기존 버전보다 뒤에 정렬되는 고유한 숫자 버전의 **새 SQL 파일**을 추가합니다. `supabase migration new <이름>`으로 생성해도 됩니다. 이번 통합 이후 이미 적용한 파일은 수정하거나 삭제하지 않습니다.
- 화면 변경: 기존처럼 `main`에 반영하면 서버 배포 성공 후 Pages가 갱신됩니다.

함수는 CLI의 API 배포 방식으로 올려 Docker가 필요하지 않습니다. `verify_jwt = false` 설정은 유지하며, 함수 자체에서 Supabase Auth로 사용자의 Bearer 토큰을 검증합니다.

## 실패와 재실행

DB 또는 함수 배포가 실패하면 Pages 배포를 진행하지 않습니다. 원인을 수정한 뒤 Actions에서 실패한 실행을 다시 실행하거나, **Run workflow → main**으로 배포할 수 있습니다. 동시에 두 배포가 DB를 변경하지 않도록 같은 워크플로의 배포를 직렬화합니다.

DB·함수·Pages는 하나의 트랜잭션이 아닙니다. 함수 배포에서 실패해도 앞서 성공한 DB 변경은 남습니다. 재실행 시 CLI는 적용 완료된 SQL을 건너뛰며 자동으로 DB를 되돌리지 않습니다. 새 SQL은 기존에 배포된 함수·화면과 함께 동작하도록 작성하고, 실패한 파일이 부분 적용되었다면 실제 상태부터 확인합니다.

초기 설정에는 `supabase link`, DB 연결과 Supabase Management API 접근이 필요합니다. 토큰·DB 비밀번호가 바뀌면 해당 GitHub Secret도 갱신합니다. 네트워크 제한을 설정한 프로젝트는 Actions 러너에서의 접속도 허용해야 합니다.

이미 성공한 자동 배포 구성은 유지합니다. 이번 이력 통합은 `main` 병합 후 실행되며, 결과는 Actions의 Supabase 단계에서 확인합니다. SQL Editor에서 별도 SQL을 실행할 필요는 없습니다.

참고: [DB push](https://supabase.com/docs/reference/cli/supabase-db-push), [migration squash](https://supabase.com/docs/reference/cli/supabase-migration-squash), [함수 배포](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

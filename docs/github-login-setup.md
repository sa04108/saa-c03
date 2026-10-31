# GitHub 로그인과 계정별 진도 저장 설정

웹페이지는 GitHub Pages에서 제공하고, GitHub 로그인과 진도 데이터는 Supabase Auth·Postgres에서 처리합니다. 별도 인증 서버나 사용자별 GitHub 저장소는 필요하지 않습니다. 작은 서비스는 Supabase 무료 플랜으로 시작할 수 있으며, 사용량 한도와 비활성 프로젝트 정책은 [현재 요금표](https://supabase.com/pricing)를 확인하세요.

## 1. Supabase 프로젝트 생성

1. [Supabase 대시보드](https://supabase.com/dashboard)에서 새 프로젝트를 만듭니다.
2. 아래 OAuth·공개 연결 정보 설정과 [GitHub Actions 배포 설정](github-actions-deploy.md)을 진행합니다.
3. 첫 배포가 빈 DB에 [통합 초기 스키마](../supabase/migrations/202610310005_initial_schema.sql)를 적용합니다. SQL Editor에서 미리 실행할 필요는 없습니다. 기존 운영 프로젝트는 이미 설치되어 있으므로 재실행하지 않습니다.

초기 스키마에는 사용자별 진도 테이블, 본인 데이터만 조회하는 RLS 정책, 저장 버전을 확인하는 `save_study_progress` 함수와 AI 관련 DB 구성이 포함됩니다. 로그인하지 않은 사용자는 접근할 수 없으며, 직접 테이블을 수정해서 버전 검사를 우회하는 것도 허용하지 않습니다.

## 2. GitHub OAuth App 등록

여기서는 저장소에 설치하는 GitHub App 대신 **OAuth App**을 사용합니다. 사용자 저장소나 Gist 접근 권한은 요청하지 않습니다.

1. Supabase의 **Authentication → Sign In / Providers → GitHub**에서 표시되는 **Callback URL**을 복사합니다. 기본 형식은 `https://<프로젝트 ID>.supabase.co/auth/v1/callback`입니다.
2. GitHub의 **Settings → Developer settings → OAuth Apps → New OAuth App**을 엽니다.
3. 다음과 같이 입력합니다.

   | 항목 | 값 |
   | --- | --- |
   | Application name | SAA-C03 학습 자료 |
   | Homepage URL | `https://saa-c03.hyunbbai.com` |
   | Authorization callback URL | Supabase에서 복사한 Callback URL |

4. 앱을 등록하고 **Client ID**와 **Client Secret**을 Supabase의 GitHub 공급자 설정에 입력해 활성화합니다.

Client Secret은 Supabase 대시보드에만 입력합니다. 저장소, 프런트엔드 코드, 채팅에 넣지 않습니다.

## 3. 로그인 후 돌아올 주소 등록

Supabase **Authentication → URL Configuration**에서 다음을 설정합니다.

- **Site URL**: `https://saa-c03.hyunbbai.com`
- **Redirect URLs**: `https://saa-c03.hyunbbai.com/`

GitHub의 Callback URL은 Supabase 주소이고, 이 Redirect URL은 사용자가 로그인 후 돌아오는 학습 사이트 주소입니다. 코드에서는 PKCE 인증으로 루트 페이지에 돌아와 세션을 복구합니다.

## 4. 공개 연결 정보 입력

Supabase의 **Connect** 또는 **Settings → API Keys**에서 Project URL과 **Publishable key**를 확인한 뒤, [assets/account-config.js](../assets/account-config.js)에 입력합니다.

```js
window.SAA_ACCOUNT_CONFIG = Object.freeze({
  supabaseUrl: 'https://<프로젝트 ID>.supabase.co',
  supabasePublishableKey: '<공개 Publishable key>',
});
```

이 두 값은 브라우저에서 사용하는 공개 설정입니다. **Secret key 또는 `service_role` 키는 사용하지 않습니다.** 데이터 접근은 로그인 세션과 DB의 RLS/RPC 권한으로 제어합니다.

설정이 비어 있으면 소셜 계정 영역에 연동 준비 중으로 표시되고, 기존 기기 저장으로 이용할 수 있습니다.

## 5. 연결 확인

`devel`에서 설정을 검토하고 `main`에 반영하면 [자동 배포 워크플로](github-actions-deploy.md)가 DB·Edge Function·Pages 순서로 배포합니다. 배포 후 다음을 확인합니다.

1. 시작 화면의 **소셜 계정 → GitHub → 계정 연동**을 눌러 승인 후 사이트로 돌아오는지 확인합니다.
2. 문제집에서 한 문제를 풀고 **계정 저장 완료** 표시를 확인합니다.
3. 다른 기기에서 같은 계정으로 로그인해 진도가 복원되는지 확인합니다.
4. 다른 계정에서는 그 진도가 보이지 않는지 확인합니다.

기존 기기 기록은 로그인했다고 자동으로 계정에 합치지 않습니다. 문제집의 **저장 · 백업 → 이 기기의 기존 기록 가져오기**로 명시적으로 가져옵니다. 이 기능과 JSON 가져오기는 현재 계정 진도를 교체하므로 필요하면 먼저 백업합니다.

## 충돌·연결 끊김·백업

- 저장 대기 기록은 계정 ID별로 기기에 보관하고 연결 복구 시 재시도합니다. 기기 저장도 사용할 수 없으면 백업 안내를 표시합니다.
- 같은 브라우저에서는 문제집의 계정 편집을 한 탭에서 진행합니다. 다른 탭이 편집 중이면 해당 탭을 닫은 뒤 다시 시도할 수 있습니다.
- 서로 다른 기기의 저장 버전이 충돌하면 서버 기록을 덮어쓰지 않습니다. 현재 기기 기록을 백업한 뒤 **서버 기록 불러오기**로 최신 진도를 불러옵니다.
- 진행 포함 HTML을 다운로드하면 로그인 자산을 제거하고 진도만 포함합니다. 다운로드 파일은 기존처럼 기기 저장으로 실행됩니다.

공식 안내: [GitHub 로그인 공급자](https://supabase.com/docs/guides/auth/social-login/auth-github), [행 수준 보안](https://supabase.com/docs/guides/database/postgres/row-level-security).

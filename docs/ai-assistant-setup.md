# AI 어시스턴트 연결

화면은 GitHub Pages, 사용자 확인·호출 제한·예상 질문 캐시는 Supabase, 답변 생성은 Gemini가 담당합니다.

```text
브라우저 → Supabase Edge Function → Gemini API
                  ↓
          Auth + Postgres
```

Gemini API 키는 Supabase의 서버 비밀값에만 넣습니다. GitHub Pages 코드와 저장소에는 넣지 않습니다. 기존 Project URL과 Publishable key는 그대로 사용합니다.

## 1. 데이터베이스 준비

기존 진도 저장 프로젝트의 SQL Editor에서 [AI 마이그레이션](../supabase/migrations/202610310001_ai_assistant.sql)을 **한 번** 실행합니다. 새 프로젝트라면 [진도 저장 마이그레이션](../supabase/migrations/202610300001_study_progress.sql)을 먼저 실행합니다.

이 마이그레이션은 다음을 설정합니다.

- 공개 학습 자료에 대한 예상 질문 4개를 보관하는 캐시
- 사이트 전체와 사용자별 요청 횟수를 원자적으로 확인하는 함수
- 서버 전용 테이블·함수 권한: 브라우저는 직접 조회하거나 수정할 수 없음
- 익명 AI 사용자가 계정용 풀이 기록 저장 기능에 접근하지 못하도록 제한

기존 GitHub 계정의 진도 데이터와 저장 API 이름은 유지합니다.

## 2. 게스트 사용 활성화

Supabase **Authentication → Sign In / Providers → Anonymous Sign-Ins**를 활성화합니다.

사용자가 처음 AI 예상 질문이나 답변을 요청할 때만 익명 세션을 생성합니다. 로그인 화면은 나타나지 않습니다. 이 세션은 `saa-c03-ai-guest-auth`에 저장하며, 기존 GitHub 로그인 세션 및 브라우저의 문제 풀이 기록과 분리합니다. GitHub에 로그인한 사용자는 기존 계정 토큰을 사용합니다.

익명 인증을 활성화해도 게스트 진도가 서버로 자동 이전되지는 않습니다. 익명 사용자가 브라우저 데이터를 지우면 새 세션을 만들 수 있으므로, 사용자별 제한에 더해 사이트 전체 한도를 적용합니다. Supabase 자체의 익명 가입 IP 제한도 유지하세요. 익명 사용자는 Auth 사용자 수에 포함되며 자동 삭제되지 않습니다. 공개 사용량이 늘면 Auth 사용량과 불필요한 익명 계정을 함께 관리하세요.

## 3. Gemini 키와 한도 설정

[Google AI Studio](https://aistudio.google.com/api-keys)에서 사용할 프로젝트의 Gemini API 키를 발급합니다. Supabase **Edge Functions → Secrets**에 다음 값을 등록합니다.

| 이름 | 값 / 기본값 |
| --- | --- |
| `GEMINI_API_KEY` | AI Studio에서 발급한 비밀 API 키 |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` |
| `ALLOWED_ORIGINS` | `https://saa-c03.hyunbbai.com` |
| `AI_GLOBAL_RPM` | 사이트 전체 분당 생성 요청 수, 기본 `5` |
| `AI_GLOBAL_RPD` | 사이트 전체 하루 생성 요청 수, 기본 `100` |
| `AI_GUEST_RPD` | 익명 세션별 하루 생성 요청 수, 기본 `10` |
| `AI_MEMBER_RPD` | 로그인 계정별 하루 생성 요청 수, 기본 `30` |

현재 공식 요금표에서 `gemini-3.5-flash-lite`는 텍스트 입출력 무료 등급을 제공합니다. **실제 사용 가능한 모델과 RPM·TPM·RPD는 해당 프로젝트의 AI Studio에서 확인하고 위 값을 맞추세요.** 기본값은 서비스 운영을 위한 제한이며 Google의 무료 할당량을 보증하는 값은 아닙니다. 모델은 서버 비밀값으로 교체할 수 있습니다.

사이트의 일일 한도는 UTC 자정에 초기화됩니다. Google의 할당량 초기화 시점과 다를 수 있으며, Google에서 429를 반환하면 재시도 안내를 표시합니다. 무료 등급을 유지하려면 Google 프로젝트의 결제 연결 상태도 확인하세요. 유료 등급에서 이 제한만으로 정확한 비용 상한을 보장하지는 않습니다.

Supabase가 제공하는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 사용합니다. 프런트엔드 설정에 추가하지 않습니다.

## 4. Edge Function 배포

Supabase **Edge Functions → Deploy a new function → Via Editor**에서 함수 이름을 **`study-assistant`**로 지정합니다. [함수 코드](../supabase/functions/study-assistant/index.ts)를 `index.ts`에 붙여 넣고 배포합니다. 외부 패키지 설치는 필요하지 않습니다.

함수의 **Verify JWT with legacy secret** 옵션은 끕니다. 이 함수는 모든 실제 요청의 Bearer 토큰을 **Supabase Auth의 `/auth/v1/user`에서 검증**하며, 인증 없이 Gemini를 호출하지 않습니다. 이 설정은 현재 Publishable key 및 JWT 서명 키 방식과 함께 동작하도록 하기 위한 것입니다. 단순히 JWT 내용을 디코딩해 신뢰하는 방식이 아닙니다.

CLI를 사용한다면 저장소 루트에서 다음과 같이 배포할 수도 있습니다. [config.toml](../supabase/config.toml)에 동일한 인증 설정이 있습니다.

```sh
supabase login
supabase link --project-ref <프로젝트-ID>
supabase functions deploy study-assistant
```

`main`의 GitHub Pages 배포는 화면과 정적 자산만 갱신합니다. Edge Function·SQL·서버 비밀값은 별도로 Supabase에 적용해야 합니다.

## 5. 동작 확인

1. 비로그인 상태에서 개념이나 문제 카드의 로봇 버튼을 눌러 예상 질문 4개가 나타나는지 확인합니다.
2. 보기를 누르면 입력창에만 채워지고 답변은 생성되지 않아야 합니다.
3. 전송 버튼을 누르면 Gemini의 실제 답변이 나타나는지 확인합니다.
4. 같은 항목을 다른 브라우저에서 열어 예상 질문 캐시가 재사용되는지 확인합니다.
5. GitHub 로그인 상태에서도 질문할 수 있고, 기존 계정 진도 저장이 정상 동작하는지 확인합니다.

예상 질문 캐시는 모델·자료 내용·프롬프트 버전별로 구분하며 30일 동안 재사용합니다. 캐시 적중은 Gemini 요청 한도를 소비하지 않습니다. 캐시 미스와 채팅 전송은 각각 1회를 사용하며, 서버에서 예약한 뒤 실패한 요청도 횟수에 포함합니다. 동시에 같은 자료를 처음 열면 중복 생성될 수 있지만 전체 한도는 초과할 수 없습니다.

질문과 답변 내역은 현재 페이지 메모리에만 보관하고 DB에 저장하지 않습니다. Gemini에는 해당 학습 자료와 현재 질문, 최근 대화 3쌍만 전달합니다. 이미지 자체는 전송하지 않으며 필요한 내용은 사용자가 텍스트로 설명해야 합니다. 무료 등급의 데이터 이용 조건에 따라 Google이 입력·출력을 제품 개선에 사용할 수 있으므로 비밀값이나 개인정보를 질문에 넣지 마세요. 현재 구현은 실시간 검색을 사용하지 않습니다.

## 연결 문제

- **연결 준비 중**: Edge Function 배포, `GEMINI_API_KEY`, 모델 이름, SQL 적용 여부를 확인합니다.
- **게스트 연결 준비 중**: Anonymous Sign-Ins가 활성화되어 있는지 확인합니다.
- **사용자 연결 만료**: 새로고침 후 재시도합니다. 게스트 세션이 관리자에 의해 삭제되었다면 해당 브라우저의 `saa-c03-ai-guest-auth`만 지우고 다시 연결할 수 있습니다.
- **호출 한도**: 사이트 한도와 Google 프로젝트 한도를 각각 확인합니다. 문제 풀이와 저장은 계속 사용할 수 있습니다.
- **CORS 오류**: 브라우저 주소의 정확한 origin을 `ALLOWED_ORIGINS`에 등록합니다. 여러 주소는 쉼표로 구분하며 경로와 끝 슬래시는 넣지 않습니다.

공식 문서: [Gemini 요금](https://ai.google.dev/gemini-api/docs/pricing), [Gemini 사용 제한](https://ai.google.dev/gemini-api/docs/rate-limits), [Supabase 익명 인증](https://supabase.com/docs/guides/auth/auth-anonymous), [Edge Function 인증](https://supabase.com/docs/guides/functions/auth).

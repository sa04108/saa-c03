# AI 어시스턴트 연결

화면은 GitHub Pages, 사용자 확인·게스트 호출 제한·예상 질문 캐시는 Supabase, 답변 생성과 프로젝트 공용 RPM·RPD·TPM 한도는 Gemini가 담당합니다.

```text
브라우저 → Supabase Edge Function → Gemini API
                  ↓
          Auth + Postgres
```

Gemini API 키는 Supabase의 서버 비밀값에만 넣습니다. GitHub Pages 코드와 저장소에는 넣지 않습니다. 기존 Project URL과 Publishable key는 그대로 사용합니다.

## 1. 데이터베이스 준비

**세션 압축 SQL `202610310004_session_compaction.sql`까지 적용한 프로젝트는 [대화 기록 삭제 SQL](../supabase/migrations/202610310005_delete_chat_history.sql)을 추가 실행**하고 최신 Edge Function과 프런트엔드를 배포합니다. 003까지만 적용했다면 [세션 압축 SQL](../supabase/migrations/202610310004_session_compaction.sql)을 먼저 실행합니다. 002까지만 적용했다면 [모델 실패 제외 정책 SQL](../supabase/migrations/202610310003_model_failure_backoff.sql)부터 순서대로 진행합니다. 이미 적용한 파일은 다시 실행하지 않습니다.

`cce61d536c2947f5ad7e8e5d469b17be291022d3`까지만 적용한 예전 환경은 먼저 [통합 업데이트 SQL](../supabase/migrations/202610310002_ai_cache_history_fallback.sql)을 적용한 뒤 모델 실패 제외 정책 SQL, 세션 압축 SQL, 대화 기록 삭제 SQL을 차례대로 실행합니다. 통합 SQL에는 항목별 캐시 전환·계정별 대화 기록·모델 fallback 제한 상태가 들어 있습니다.

이전에 안내한 `202610310002_suggestion_cache_by_item.sql`, `202610310003_chat_history.sql`은 통합 파일로 대체했으므로 따로 실행하지 않습니다. SQL 실행 후 최신 `study-assistant` Edge Function을 다시 배포하세요.

새로 설치한다면 다음 순서로 각각 한 번 실행합니다. 이미 적용한 SQL은 다시 실행하지 않습니다.

1. [진도 저장 마이그레이션](../supabase/migrations/202610300001_study_progress.sql) — 기존 진도 저장 프로젝트라면 생략
2. [AI 마이그레이션](../supabase/migrations/202610310001_ai_assistant.sql) — 공용 Gemini 할당량 정책과 게스트 제한 포함
3. [통합 업데이트 SQL](../supabase/migrations/202610310002_ai_cache_history_fallback.sql)
4. [모델 실패 제외 정책 SQL](../supabase/migrations/202610310003_model_failure_backoff.sql)
5. [세션 압축 SQL](../supabase/migrations/202610310004_session_compaction.sql)
6. [대화 기록 삭제 SQL](../supabase/migrations/202610310005_delete_chat_history.sql)

이 마이그레이션은 다음을 설정합니다.

- 공개 학습 자료에 대한 예상 질문 4개를 보관하는 캐시
- 익명 세션별 일일 요청 횟수를 원자적으로 확인하는 함수
- 서버 전용 테이블·함수 권한: 브라우저는 직접 조회하거나 수정할 수 없음
- 익명 AI 사용자가 계정용 풀이 기록 저장 기능에 접근하지 못하도록 제한

기존 GitHub 계정의 진도 데이터와 저장 API 이름은 유지합니다. 이 SQL을 적용한 뒤 아래 절차에 따라 최신 `study-assistant` Edge Function을 배포합니다.

## 2. 게스트 사용 활성화

Supabase **Authentication → Sign In / Providers → Anonymous Sign-Ins**를 활성화합니다.

사용자가 처음 AI 예상 질문이나 답변을 요청할 때만 익명 세션을 생성합니다. 로그인 화면은 나타나지 않습니다. 이 세션은 `saa-c03-ai-guest-auth`에 저장하며, 기존 GitHub 로그인 세션 및 브라우저의 문제 풀이 기록과 분리합니다. GitHub에 로그인한 사용자는 기존 계정 토큰을 사용합니다.

익명 인증을 활성화해도 게스트 진도가 서버로 자동 이전되지는 않습니다. 익명 세션에는 기본 하루 10회 제한을 추가로 적용하며, 로그인 사용자는 개인별 요청 제한 없이 Google 프로젝트의 공용 할당량을 사용합니다. 게스트 요청도 같은 Google 할당량을 소비합니다. 브라우저 데이터를 지우면 새 익명 세션을 만들 수 있으므로 이 제한은 사람 단위의 식별이 아닙니다. Supabase 자체의 익명 가입 IP 제한도 유지하세요. 익명 사용자는 Auth 사용자 수에 포함되며 자동 삭제되지 않습니다.

## 3. Gemini·Tavily 키와 한도 설정

[Google AI Studio](https://aistudio.google.com/api-keys)에서 사용할 프로젝트의 Gemini API 키를 발급합니다. Supabase **Edge Functions → Secrets**에 다음 값을 등록합니다.

| 이름 | 값 / 기본값 |
| --- | --- |
| `GEMINI_API_KEY` | AI Studio에서 발급한 비밀 API 키 |
| `TAVILY_API_KEY` | Tavily에서 발급한 비밀 API 키. 채팅의 웹 검색에 사용 |
| `ALLOWED_ORIGINS` | `https://saa-c03.hyunbbai.com` |
| `AI_GUEST_RPD` | 익명 세션별 하루 생성 요청 수, 기본 `10` |

모델은 함수 코드의 `geminiModels` 목록으로 관리합니다. `gemini-3.8-flash` → `gemini-3.6-flash` → `gemini-3-flash-preview` → `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` 순서이며, 모두 현재 요금표에서 텍스트 입출력 무료 등급을 제공합니다. 기존 `GEMINI_MODEL` 비밀값은 읽지 않으므로 삭제해도 됩니다. [모델 선정 근거와 fallback 정책](gemini-routing.md)을 참고하세요. **RPM·RPD·TPM 기본 정책은 Google 프로젝트에 실제 할당된 한도를 그대로 사용하는 것입니다.** 사이트에 별도의 최대 요청 수나 분당 토큰 수를 설정하지 않으며, 모델별 고정 최대치를 추측해서 넣지도 않습니다. 실제 값은 [AI Studio 한도 화면](https://aistudio.google.com/rate-limit?timeRange=last-28-days)에서 프로젝트와 모델을 선택해 확인합니다. Google이 할당량을 변경하면 사이트 설정을 바꾸지 않아도 새 한도가 적용됩니다.

| 항목 | 기본 동작 |
| --- | --- |
| RPM · 분당 요청 수 | Google의 해당 프로젝트·모델 한도를 모든 사용자가 공유 |
| RPD · 하루 요청 수 | Google의 해당 프로젝트·모델 한도를 모든 사용자가 공유 |
| TPM · 분당 입력 토큰 수 | Google이 실제 입력 토큰을 계산해 한도 적용 |
| 로그인 계정별 요청 수 | 별도 제한 없음 |
| 익명 세션별 요청 수 | 하루 10회, `AI_GUEST_RPD`로 조정 가능 |

이전 `AI_GLOBAL_RPM`, `AI_GLOBAL_RPD`, `AI_MEMBER_RPD` 비밀값은 더 이상 읽지 않습니다. Supabase에 남아 있어도 제한을 만들지 않으며 삭제해도 됩니다. 서버의 입력 크기·대화 길이·답변 길이 제한은 요청 형식과 응답 크기를 위한 것으로 그대로 유지합니다.

게스트의 일일 제한은 기존처럼 UTC 자정에 초기화됩니다. Google의 RPD는 미국 태평양 시간 자정에 초기화됩니다. 각 모델은 **최대 5초씩 독립적으로** 기다립니다. 429·503 등 일시적 오류나 5초 초과 시 다음 모델로 전환하고, 실패한 모델은 **1분 → 1시간 → 1일** 순서로 제외합니다. 이후 연속 실패도 1일을 유지하며 정상 답변을 완성하면 초기화합니다. 이는 Google의 실제 한도가 아닌 모델 재시도 정책입니다. 서버 전체가 실패 횟수와 제외 기간을 공유합니다. 같은 프로젝트의 다른 앱에서 사용한 요청도 Google의 공용 할당량에 포함될 수 있습니다.

무료 등급을 유지하려면 Google 프로젝트의 결제 연결 상태를 확인하세요. 유료 프로젝트를 사용하면 요청에 따라 과금되며 사이트가 별도의 비용 상한을 적용하지 않습니다.

Supabase가 제공하는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 사용합니다. 프런트엔드 설정에 추가하지 않습니다.

`TAVILY_API_KEY`도 **Supabase Edge Functions → Secrets**에 등록해야 합니다. Codex 클라우드 환경에 주입한 키는 Supabase로 자동 전달되지 않습니다. Gemini가 질문·학습 자료·대화 맥락을 보고 필요한 경우에만 Tavily 검색 도구를 호출합니다. 질문 한 번당 검색은 최대 한 번이며, Gemini 모델이 오류나 시간 초과로 전환되어도 같은 검색 결과를 재사용합니다. 검색 도구 선택과 검색 후 답변의 Gemini 호출 시간은 모델당 합계 5초입니다. 예상 질문 생성에는 Tavily를 호출하지 않습니다. 이 검색 판단 변경에는 추가 SQL이 없습니다. [Tavily 설정과 검색 동작](tavily-search.md)을 참고하세요.

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
3. 기본 개념 질문에는 바로 답하고, 최신 정보의 공식 문서 확인 요청에는 검색을 사용하는지 확인합니다. 실제 검색 결과가 있을 때만 **웹 검색 자료** 링크가 붙습니다. 검색을 시도했다가 실패하면 최신 정보를 확인하지 못했다는 안내가 나타납니다.
4. 같은 항목을 다른 브라우저에서 열어 예상 질문 캐시가 재사용되는지 확인합니다.
5. GitHub 로그인 상태에서도 질문할 수 있고, 기존 계정 진도 저장이 정상 동작하는지 확인합니다.

예상 질문은 **항목 ID당 한 행**으로 모든 사용자가 공유합니다. 예를 들어 `dumps:63`은 문제집 63번, `concept:/terms/acm.html`은 ACM 개념의 캐시입니다. 모델·프롬프트 버전·자료 내용의 SHA-256 지문은 키에 포함하지 않고 해당 행의 재사용 여부를 판단하는 정보로 저장합니다. 시간에 따른 만료는 없습니다.

서버에 예상 질문 요청이 들어오면 해당 ID 한 행만 조회합니다. 세 정보가 모두 같으면 기존 목록을 반환하고, 하나라도 바뀌면 기존 목록을 비운 뒤 새로 생성한 질문 4개로 같은 행을 채웁니다. 과거 모델이나 버전을 열거해 키를 계산하지 않습니다. 동시에 진행되던 구버전 생성이 늦게 끝나도 새 목록을 덮어쓸 수 없습니다. 생성에 실패하면 이전 목록을 반환하지 않고 다음 요청에서 다시 시도합니다. 아직 요청하지 않은 다른 항목은 그대로 두고, 각 항목의 다음 요청에서 유효성을 확인합니다.

프롬프트 버전은 함수 코드의 `suggestionPromptVersion`입니다. 예상 질문 생성 지침·응답 형식을 변경할 때 올립니다. 실제 생성 모델이 바뀌면 모델 메타데이터로, 자료가 바뀌면 내용 지문으로 감지합니다. fallback 중에도 항목당 한 행만 유지합니다. 제한 중인 모델이 만든 유효한 캐시를 만나면 Gemini를 호출하지 않고 재사용할 수 있습니다. 이미 열린 페이지의 질문 목록은 그 페이지 메모리에 남을 수 있으며, 새 서버 요청부터 변경을 확인합니다.

API를 시도하기 전에 캐시가 적중하면 Gemini 호출과 게스트 요청 횟수를 소비하지 않습니다. 캐시 미스와 채팅 전송은 우선순위 순으로 Gemini를 호출하며, 일시적 오류나 5초 초과 시 다음 모델을 최대 한 번씩 시도합니다. fallback 횟수와 관계없이 한 사용자 요청에서 게스트 횟수는 한 번만 차감합니다. 모든 모델이 이미 대기 중이라 실제 호출을 하지 않으면 차감하지 않습니다. 게스트는 서버에서 횟수를 예약한 뒤 실패한 요청도 기존처럼 횟수에 포함합니다. 한도를 소진한 게스트의 캐시 미스는 기존 캐시를 수정하지 않습니다. 로그인 사용자의 요청은 별도 일일 카운터에 기록하지 않습니다. 동시에 같은 자료를 처음 열면 중복 생성될 수 있으며, 모든 후보가 429로 막혔으면 429, 장애·시간 초과가 섞이면 503으로 응답합니다.

GitHub 계정을 연동한 사용자의 완성된 질문·답변은 계정별 DB에 저장합니다. 익명 사용자는 저장·조회할 수 없고 현재 페이지 메모리에서만 대화합니다. 대화 기록은 예상 질문 공용 캐시와 별개이며, 본인 계정만 조회할 수 있습니다. 저장 실패 시 답변은 표시하되 실패를 안내하고, **다시 저장**은 AI를 다시 호출하지 않습니다. [무료 플랜 용량과 세션별 대화 기록 운영](chat-history.md)을 참고하세요.

Gemini에는 학습 자료·현재 질문과 해당 세션의 요약·아직 요약하지 않은 원문을 전달하고, 검색한 경우 그 발췌도 전달합니다. 익명 사용자는 기존처럼 최근 3쌍만 전달합니다. Tavily에는 Gemini가 검색이 필요하다고 판단했을 때만 모델이 만든 400자 이내 검색어를 보냅니다. 모델에는 관련 공개 기술 용어만 사용하고 개인정보·비밀값·전체 대화를 검색어에 복사하지 않도록 지시합니다. 저장된 전체 기록을 매번 보내지 않습니다. 이미지 자체는 전송하지 않으며 필요한 내용은 사용자가 텍스트로 설명해야 합니다. 무료 등급의 데이터 이용 조건에 따라 Google이 입력·출력을 제품 개선에 사용할 수 있으므로 비밀값이나 개인정보를 질문에 넣지 마세요.

## 연결 문제

- **연결 준비 중**: Edge Function 배포, `GEMINI_API_KEY`, 모델 이름, SQL 적용 여부를 확인합니다.
- **게스트 연결 준비 중**: Anonymous Sign-Ins가 활성화되어 있는지 확인합니다.
- **사용자 연결 만료**: 새로고침 후 재시도합니다. 게스트 세션이 관리자에 의해 삭제되었다면 해당 브라우저의 `saa-c03-ai-guest-auth`만 지우고 다시 연결할 수 있습니다.
- **게스트 하루 한도**: GitHub로 로그인하거나 UTC 자정 이후 다시 이용합니다. 로그인해도 Google의 공유 할당량이 소진된 경우에는 기다려야 합니다.
- **공유 이용 한도**: AI Studio에서 해당 프로젝트·모델의 RPM·RPD·TPM을 확인합니다. 다른 사용자나 같은 프로젝트의 다른 앱과 할당량을 공유합니다. 문제 풀이와 저장은 계속 사용할 수 있습니다.
- **웹 검색 불가 안내**: Supabase의 `TAVILY_API_KEY`, Tavily 크레딧·요청 한도, 검색 API 연결 상태를 확인합니다. 검색은 최대 6초 기다린 뒤 실패 안내와 함께 일반 답변을 생성합니다.
- **CORS 오류**: 브라우저 주소의 정확한 origin을 `ALLOWED_ORIGINS`에 등록합니다. 여러 주소는 쉼표로 구분하며 경로와 끝 슬래시는 넣지 않습니다.

공식 문서: [Gemini 요금](https://ai.google.dev/gemini-api/docs/pricing), [Gemini 사용 제한](https://ai.google.dev/gemini-api/docs/rate-limits), [Supabase 익명 인증](https://supabase.com/docs/guides/auth/auth-anonymous), [Edge Function 인증](https://supabase.com/docs/guides/functions/auth).

입력 토큰 한도·공식 제공자의 압축 방식 비교·실행 조건·추가 호출 비용은 [대화 맥락 정책](ai-context-policy.md)에 정리했습니다. 계정 연동 세션은 입력 16,000토큰 이내에서 답변하고, 약 12,000토큰부터 오래된 대화를 백그라운드에서 요약합니다. 요약도 Gemini 공용 할당량을 사용하며 원문 기록은 유지합니다.

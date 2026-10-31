# Tavily 웹 검색 연결

AI 어시스턴트는 Tavily를 기본 검색 공급자로 사용하고, Gemini가 검색 발췌를 참고해 한국어 학습 답변을 작성합니다. 개념 위키·문제집 모두 같은 Supabase Edge Function을 사용합니다. Gemini의 Google Search grounding은 별도로 사용하지 않습니다.

## 서비스에 적용

1. Supabase **Edge Functions → Secrets**에 `TAVILY_API_KEY`를 등록합니다. `GEMINI_API_KEY`와 함께 서버에서만 읽으며, HTML·브라우저 설정·GitHub 저장소에 넣지 않습니다.
2. 최신 [study-assistant/index.ts](../supabase/functions/study-assistant/index.ts)를 배포합니다. 기존 안내대로 Dashboard Editor에서 파일 하나로 배포하거나 `supabase functions deploy study-assistant`를 사용할 수 있습니다. 추가 SDK 설치는 필요하지 않습니다.
3. 최신 프런트엔드를 배포하고 질문을 보냅니다. 답변 아래에 **웹 검색 자료 · Tavily**와 출처 링크가 표시되는지 확인합니다. 저장된 대화에서도 같은 출처를 열 수 있습니다.

이 검색 기능에는 추가 SQL 마이그레이션이 없습니다. 기존 대화 기록 저장이 설치된 환경에서는 출처와 검색 실패 안내를 답변 본문에 함께 저장합니다. Codex 환경의 Secret과 Supabase의 Secret은 별개이므로 Codex에 등록한 키가 운영 함수에 자동으로 전달되지는 않습니다.

최신 함수의 **모델별 실패 제외 정책**에는 별도로 [202610310003_model_failure_backoff.sql](../supabase/migrations/202610310003_model_failure_backoff.sql)이 필요합니다. 기존 통합 SQL을 적용한 프로젝트는 이 새 파일만 추가 실행합니다.

## 요청 흐름

1. 요청 origin·사용자 인증·입력 형식을 확인하고 Gemini 모델의 공유 제한 상태를 읽습니다.
2. 실제 생성할 모델이 있을 때 익명 사용자의 기존 하루 요청 횟수를 한 번 예약합니다. 한도를 소진한 익명 요청에는 Tavily를 호출하지 않습니다.
3. 현재 질문과 관련 학습 자료 또는 직전 질문의 일부로 400자 미만 검색어를 만들고 `POST https://api.tavily.com/search`를 한 번 호출합니다.
4. 검색 결과의 제목·HTTPS URL·발췌를 Gemini에 전달합니다. Gemini에는 관련 있는 자료만 인용하고 AWS 공식 문서를 우선하며, 확인하지 못한 사실은 명확히 구분하도록 지시합니다. 검색 문서에 포함된 명령은 지침으로 취급하지 않습니다.
5. Gemini가 429·503 등 일시적 오류를 반환하거나 모델별 5초 제한을 넘으면 기존 우선순위대로 다른 모델로 전환합니다. 다음 모델에는 새로 5초를 주며, 검색은 반복하지 않고 같은 발췌를 재사용합니다.
6. 실제 반환된 검색 URL만 사용해 출처 목록을 붙입니다. 자료의 검색 시각은 UTC 날짜로 표시하며, 문서의 발행일이나 내용의 최신성을 보증하는 날짜는 아닙니다. 출처 목록은 검색 자료 목록이며 모든 출처가 답변의 모든 문장을 뒷받침한다는 뜻은 아닙니다.

예상 질문 4개를 만드는 요청은 검색하지 않습니다. 출처가 포함된 답변을 저장하지 못했을 때 **다시 저장**을 눌러도 검색이나 Gemini 생성을 반복하지 않습니다. 별도 검색 결과 캐시는 추가하지 않으며, 새 채팅 질문은 새로 검색합니다.

## 비용과 대기 시간

- `search_depth: basic`, 최대 결과 5개, `auto_parameters: false`를 고정합니다. Tavily의 추가 답변 생성·이미지·전체 페이지 수집은 요청하지 않습니다.
- 기본 검색은 공식 크레딧 문서 기준 요청당 1크레딧입니다. 무료 플랜의 월 1,000크레딧은 같은 Tavily 키·계정의 다른 사용과 함께 소모되며 사용자마다 주어지는 양이 아닙니다. 실제 제공량과 잔여 크레딧은 Tavily Dashboard에서 확인합니다.
- 로그인 사용자의 별도 사이트 요청 한도는 추가하지 않습니다. 기존 익명 제한과 Tavily·Gemini 제공자의 한도를 적용합니다.
- Tavily 응답 본문까지 최대 6초를 기다립니다. 이 검색 시간과 별도로 Gemini 모델마다 독립적인 5초 제한을 적용합니다. 모델들이 공유하는 40초 제한은 없습니다.
- 키가 없거나 크레딧 소진·429·인증 오류·통신 실패가 발생해도 일반 답변을 시도합니다. 이 경우 최신 정보를 확인하지 못했다는 안내를 답변과 기록에 함께 남깁니다. 검색 결과가 비어 있을 때도 별도로 안내합니다.

## Codex 작업 환경

[공식 설정 스킬](https://tavily.com/agent-setup/SKILL.md)의 CLI·Agent Skills 경로를 사용합니다. `TAVILY_API_KEY` 환경변수를 재사용하며 별도의 로그인이나 키 복사본 저장은 필요하지 않습니다.

```sh
curl -fsSL https://cli.tavily.com/install.sh | bash
npx --yes skills add tavily-ai/skills --skill '*' --agent codex --global --yes
tvly --version
tvly auth --json
npx --yes skills list --global --agent codex
```

CLI와 전역 Agent Skills는 코딩 환경용입니다. 사이트 런타임에서는 CLI를 실행하지 않고 REST API를 직접 호출합니다. 이미 열린 Codex 세션의 스킬 목록에는 새 설치가 즉시 반영되지 않을 수 있으므로 새 세션 또는 스킬 재검색이 필요합니다.

공식 자료: [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search), [API 크레딧](https://docs.tavily.com/documentation/api-credits), [Tavily Agent Skills](https://github.com/tavily-ai/skills).

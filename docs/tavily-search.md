# Tavily 웹 검색 연결

AI 어시스턴트는 **Gemini가 필요하다고 판단할 때만** Tavily를 검색 도구로 사용합니다. 검색이 필요 없으면 바로 한국어 학습 답변을 작성합니다. 개념 위키·문제집 모두 같은 Supabase Edge Function을 사용합니다. Gemini의 Google Search grounding은 별도로 사용하지 않습니다.

## 서비스에 적용

1. Supabase **Edge Functions → Secrets**에 `TAVILY_API_KEY`를 등록합니다. `GEMINI_API_KEY`와 함께 서버에서만 읽으며, HTML·브라우저 설정·GitHub 저장소에 넣지 않습니다.
2. 최신 [study-assistant/index.ts](../supabase/functions/study-assistant/index.ts)를 배포합니다. 기존 안내대로 Dashboard Editor에서 파일 하나로 배포하거나 `supabase functions deploy study-assistant`를 사용할 수 있습니다. 추가 SDK 설치는 필요하지 않습니다.
3. 최신 프런트엔드를 배포하고 기본 개념 질문과 공식 문서 검색 요청을 각각 보냅니다. 실제 검색한 답변에만 **웹 검색 자료 · Tavily**와 출처 링크가 표시됩니다. 저장된 대화에서도 같은 출처를 열 수 있습니다.

이 검색 기능에는 추가 SQL 마이그레이션이 없습니다. 기존 대화 기록 저장이 설치된 환경에서는 출처와 검색 실패 안내를 답변 본문에 함께 저장합니다. Codex 환경의 Secret과 Supabase의 Secret은 별개이므로 Codex에 등록한 키가 운영 함수에 자동으로 전달되지는 않습니다.

최신 함수의 **모델별 실패 제외 정책**에는 별도로 [202610310003_model_failure_backoff.sql](../supabase/migrations/202610310003_model_failure_backoff.sql)이 필요합니다. 기존 통합 SQL을 적용한 프로젝트는 이 새 파일만 추가 실행합니다.

## 요청 흐름

1. 요청 origin·사용자 인증·입력 형식을 확인하고 Gemini 모델의 공유 제한 상태를 읽습니다.
2. 실제 생성할 모델이 있을 때 익명 사용자의 기존 하루 요청 횟수를 한 번 예약합니다. 한도를 소진한 익명 요청에는 Tavily를 호출하지 않습니다.
3. Gemini에 현재 질문·학습 자료·최근 대화와 `search_web` 도구를 전달합니다. 함수 호출 모드는 `AUTO`이며, 모델이 직접 답변하거나 검색을 요청합니다. 별도의 분류 모델이나 키워드 규칙으로 검색을 강제하지 않습니다.
4. 검색을 요청하면 모델이 만든 400자 이내 검색어를 검증하고 `POST https://api.tavily.com/search`를 최대 한 번 호출합니다. 도구 이름·인자 길이를 검증하며, 검색 대상 API와 검색 옵션은 서버에서 고정합니다.
5. 검색 결과의 제목·HTTPS URL·발췌를 도구 응답으로 Gemini에 전달해 답변을 완성합니다. 같은 모델에는 함수 호출 ID와 추론 서명 등 원래 응답 파트를 보존합니다. 이후 도구 호출은 `NONE`으로 막습니다. 관련 자료만 인용하고 AWS 공식 문서를 우선하며, 검색 문서에 포함된 명령은 지침으로 취급하지 않습니다.
6. Gemini가 429·503 등 일시적 오류를 반환하거나 모델별 5초 제한을 넘으면 기존 우선순위대로 다른 모델로 전환합니다. 이미 검색했다면 다음 모델은 그 결과로 바로 답변하며 다시 검색하지 않습니다. 아직 검색하지 않았다면 다음 모델이 검색 여부를 판단합니다.
7. 실제 검색 결과가 있을 때만 출처 목록을 붙입니다. 자료의 검색 시각은 UTC 날짜로 표시하며, 문서의 발행일이나 내용의 최신성을 보증하는 날짜는 아닙니다. 출처 목록은 검색 자료 목록이며 모든 출처가 답변의 모든 문장을 뒷받침한다는 뜻은 아닙니다.

모델에는 최신 요금·할당량·리전별 지원·최근 변경, 사용자의 명시적 검색·공식 출처 확인 요청, 답변에 중요한 불확실한 사실을 확인할 때 검색하도록 지시합니다. 기본 개념·주어진 문제의 추론·힌트·요약·표현 수정·인사에는 외부 확인이 필요 없으면 바로 답하도록 지시합니다. 이는 모델 판단을 위한 기준이며, 특정 문구가 검색 여부를 보장하는 규칙은 아닙니다.

예상 질문 4개를 만드는 요청에는 검색 도구를 제공하지 않습니다. 출처가 포함된 답변을 저장하지 못했을 때 **다시 저장**을 눌러도 검색이나 Gemini 생성을 반복하지 않습니다. 별도 검색 결과 캐시는 추가하지 않으며, 새 채팅 질문마다 검색 필요성을 다시 판단합니다.

## 비용과 대기 시간

- `search_depth: basic`, 최대 결과 5개, `auto_parameters: false`를 고정합니다. Tavily의 추가 답변 생성·이미지·전체 페이지 수집은 요청하지 않습니다.
- 기본 검색은 공식 크레딧 문서 기준 요청당 1크레딧입니다. 무료 플랜의 월 1,000크레딧은 같은 Tavily 키·계정의 다른 사용과 함께 소모되며 사용자마다 주어지는 양이 아닙니다. 실제 제공량과 잔여 크레딧은 Tavily Dashboard에서 확인합니다.
- 검색 없이 답하면 Gemini 생성 호출 한 번으로 끝납니다. 검색을 선택하면 같은 모델에 도구 결과를 전달하는 생성 호출이 한 번 추가됩니다. 두 호출 모두 Google의 사용량에 포함되지만, 사이트의 익명 요청 횟수는 사용자 메시지당 한 번만 차감합니다. fallback 시 추가 모델 호출이 발생할 수 있습니다.
- 로그인 사용자의 별도 사이트 요청 한도는 추가하지 않습니다. 기존 익명 제한과 Tavily·Gemini 제공자의 한도를 적용합니다.
- Tavily 응답 본문까지 최대 6초를 기다립니다. Gemini는 **모델마다 독립적으로 합계 5초**를 사용합니다. 도구 선택에 1초를 썼다면 검색 후 답변에는 남은 약 4초를 주며, Tavily 시간은 이 합계에서 제외합니다. 다음 fallback 모델에는 새로 5초를 줍니다. 모델들이 공유하는 40초 제한은 없습니다.
- 검색을 시도한 뒤 크레딧 소진·429·인증 오류·통신 실패가 발생해도 답변을 시도하며, 최신 정보를 확인하지 못했다는 안내를 답변과 기록에 함께 남깁니다. 검색 결과가 비어 있을 때도 별도로 안내합니다. 모델이 검색하지 않은 답변에는 검색 실패 안내를 붙이지 않습니다. Tavily 키가 없으면 검색 도구를 제공하지 않고 실시간 확인을 했다고 주장하지 않도록 지시합니다.

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

공식 자료: [Gemini 함수 호출](https://ai.google.dev/gemini-api/docs/function-calling), [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search), [API 크레딧](https://docs.tavily.com/documentation/api-credits), [Tavily Agent Skills](https://github.com/tavily-ai/skills).

# AI 주식 추천 비서 (카카오톡 연동) — MVP 설계 문서

- 작성일: 2026-07-27
- 상태: 사용자 승인 대기
- 범위: Phase 1 (MVP) — 아래 "향후 단계"는 이번 스펙의 구현 대상이 아님

## 1. 개요

뉴스(국내: 네이버·다음 / 해외: 무료 RSS)를 자동으로 수집·분석해서, 특정 테마·종목과의
연관성을 판단하고, 과거에 비슷한 뉴스가 있었을 때 실제 주가가 어떻게 움직였는지 통계를 참고해
"예상 흐름"을 만들어내는 개인용 AI 비서. 카카오톡으로 질문하면 답하고, 큰 이슈가 있으면
먼저 알림도 보낸다(알림 기능은 Phase 2, 아래 참고).

**사용 대상**: 사용자 본인 1인 전용 개인 비서. 공개 서비스 아님.

**면책 원칙**: 모든 응답에는 "투자 참고용이며 투자 판단과 책임은 본인에게 있음"을 항상 명시한다.
실제 예측이 아니라 과거 통계 기반의 참고 의견임을 매 응답에서 분명히 한다.

## 2. 사용자 시나리오 (예시)

```
사용자(카카오톡): 실시간 흐름이랑 예상하락종목 알려줘

비서: [3시간 전] 월가에서 조류독감 확산 뉴스가 나왔고, 국내 얼리프리 시장에서
축산업 테마가 하락 반응을 보이고 있어요.

과거에 비슷한 "조류독감/가축전염병" 뉴스가 있었을 때, 축산업 테마 종목은
평균적으로 3거래일 내 -2~4% 하락했던 사례가 있어요 (최근 N건 기준).

그래서 당분간 축산업 테마는 신규 매수를 지양하시는 게 나아 보여요.
(투자 참고용이며 최종 판단과 책임은 본인에게 있습니다)
```

3거래일 뒤, 시스템은 실제로 축산업 테마가 얼마나 움직였는지 확인하고 내부 기록에
정확도를 남긴다 (사용자에게 매번 알리지는 않음, 필요 시 "요즘 예측 정확도 어때?"라고
물어보면 답할 수 있음 — 이 질의응답은 MVP 범위에 포함).

## 3. 아키텍처

```
[뉴스 소스: 네이버/다음 검색 API, 해외 무료 RSS]
[시세 소스: 15~20분 지연 무료 시세 + 일별 종가]
                │
                ▼
      [수집기 Collector] (Vercel Cron, 15~30분 주기)
                ▼
      [분석·예측 엔진] (Claude API 호출)
      - 뉴스 → 테마/종목 태깅, 호재/악재/중립 판단
      - price_history 기반 "테마별 과거 반응 통계" 조회
      - 태깅 + 통계 + 문맥을 종합해 예측 문장 생성
                ▼
         [Supabase DB]
        ▲              │
        │              ▼
[카카오톡 웹훅 서버]   [피드백 체커] (매일 1회, Vercel Cron)
   (Vercel Function)   예측 vs 실제 결과 비교·기록
        ▲
        │
  [사용자 카카오톡 채팅]
```

### 구성요소

| 구성요소 | 역할 | 실행 방식 |
|---|---|---|
| Collector | 뉴스·시세 수집 후 DB 저장 | Vercel Cron (15~30분 주기) |
| Analyzer | 뉴스 태깅 + 통계 조회 + 예측 생성 | Collector 직후 자동 실행 |
| Kakao Webhook | 사용자 질문에 답변 (i 오픈빌더 스킬 서버) | Vercel Function (HTTP) |
| Feedback Checker | 지난 예측의 실제 결과 확인·기록 | Vercel Cron (일 1회) |

## 4. 데이터 모델 (Supabase)

| 테이블 | 주요 컬럼 | 설명 |
|---|---|---|
| `stocks` | id, ticker, name, market(KOSPI/KOSDAQ), market_cap_rank | 종목 마스터, 초기 약 100개 시드 |
| `themes` | id, name | 반도체, 2차전지, 바이오, 자동차, 조선, 항공, 화장품, 게임 등 |
| `stock_themes` | stock_id, theme_id | 종목-테마 N:M 매핑 |
| `news_items` | id, source, url, title, summary, published_at, collected_at | 수집된 뉴스 원문 |
| `news_tags` | id, news_item_id, theme_id, sentiment(호재/악재/중립), confidence, reasoning | Claude 분석 결과 |
| `price_history` | id, stock_id, date, close_price, change_pct | 일별 종가 (통계용) |
| `intraday_quotes` | id, stock_id, captured_at, price, change_pct | 15~20분 지연 시세 스냅샷 (현재 흐름용) |
| `predictions` | id, created_at, theme_id, stock_id(nullable), direction, range_low, range_high, confidence, reasoning, check_after_days, checked(bool) | 예측 기록 |
| `prediction_feedback` | id, prediction_id, actual_change_pct, accuracy_note, checked_at | 예측 vs 실제 비교 결과 |
| `kakao_conversations` | id, question, answer, created_at | 챗봇 대화 로그 (디버깅·문맥 유지용) |

## 5. 데이터 흐름

**(A) 백그라운드 수집·분석 흐름**
1. Collector가 새 뉴스/시세를 가져와 `news_items`, `price_history`, `intraday_quotes`에 저장
2. Analyzer가 미분석 뉴스에 대해 Claude 호출 → `news_tags` 기록
3. 태깅된 테마에 대해 과거 유사 사례 통계를 `price_history`+`news_tags` 조합으로 계산
4. 통계 + 현재 뉴스 맥락을 Claude가 종합 → `predictions`에 기록 (check_after_days 설정, 예: 3거래일)

**(B) 사용자 질의응답 흐름**
1. 사용자가 카카오톡으로 질문 → Kakao 서버가 웹훅으로 우리 서버 호출
2. 웹훅 서버가 최근 `news_tags`, `intraday_quotes`, `predictions`를 조회
3. Claude가 이를 종합해 사람이 읽기 편한 답변 문장 생성 (면책 문구 포함)
4. 5초 내 응답이 어려우면 "분석 중" 메시지 먼저 전송 후 콜백으로 실제 답변 이어서 전송 (카카오 i 오픈빌더 콜백 기능 사용)
5. 질문/답변을 `kakao_conversations`에 로그

**(C) 피드백 흐름**
1. 매일 1회, `check_after_days`가 지난 미확인(`checked=false`) 예측을 조회
2. 실제 가격 변화를 `price_history`에서 조회해 비교
3. `prediction_feedback`에 결과 기록, `predictions.checked=true`로 갱신
4. 이후 통계 계산 시 이 피드백 데이터도 함께 참고해 신뢰도를 조정

## 6. 에러 처리

- 뉴스/시세 수집 실패: 해당 회차는 건너뛰고 다음 주기에 재시도, 실패 로그 기록. 전체 파이프라인이 한 소스 실패로 멈추지 않도록 소스별로 독립 처리.
- Claude 분석 실패: 해당 뉴스를 "미분석" 상태로 유지, 다음 배치에서 재시도.
- 카카오 웹훅 5초 제한: 콜백 방식으로 우회 (위 5단계 참고).
- 통계 데이터 부족: "아직 참고할 과거 사례가 충분하지 않습니다"라고 답변에 명시하고, 없는 확신을 지어내지 않는다.
- 외부 API(뉴스/시세) 응답 형식 변경: 파싱 실패 시 에러 로그만 남기고 스킵 (서비스 전체 중단 방지). 이 부분은 API 정책이 자주 바뀌므로 운영 중 지속적인 확인이 필요함 — **확인 필요**.

## 7. 테스트 계획

각 구성요소를 순서대로 실제로 돌려보며 확인한다 (사용자도 함께 결과를 확인).

1. Collector 단독 실행 → 뉴스/시세가 DB에 실제로 쌓이는지 확인
2. Analyzer 태깅 결과 샘플 검토 → 사람이 봐도 납득되는 테마/톤 판단인지 확인
3. 예측 문장 생성 결과가 자연스러운 카톡 메시지 형태인지 확인
4. 카카오 테스트 채널에 실제 연결 → 직접 질문해서 답변이 오는지 확인 (5초 제한 대응 포함)
5. 하루~며칠 뒤 Feedback Checker가 실제로 `prediction_feedback`을 기록하는지 확인

## 8. 배포 & 보안

- 배포: Vercel (서버 함수 + Cron), DB: Supabase
- 모든 API 키(Claude API, 카카오 REST API 키, Supabase 키 등)는 `.env` 및 Vercel 환경 변수로만 관리, 코드에 하드코딩하지 않음 (CLAUDE.md 보안 규칙 준수)
- 배포 전 비밀 키/개인정보 하드코딩 여부 최종 점검

## 9. 범위 밖 (향후 단계, 이번 스펙 대상 아님)

- **Phase 2**: 선제적 알림(봇이 먼저 카톡 발송) — 카카오 비즈메시지(친구톡) API 신청·템플릿 승인 필요 (외부 승인 절차라 소요 기간 불확실)
- **Phase 3**: 증권사 Open API 연동으로 진짜 실시간(초 단위) 시세 업그레이드 (사용자 계좌 개설 필요)
- **Phase 4**: 피드백 데이터가 충분히 쌓인 후 통계/모델 고도화

## 10. 확인 필요 항목

- 15~20분 지연 무료 시세 소스의 정확한 지연 시간·요청 제한은 구현 시점에 재확인 필요
- 초기 시드 종목/테마 100개 목록은 구현 단계에서 구체적으로 확정 필요
- 카카오 i 오픈빌더 콜백 응답 정책(시간 제한 등)은 구현 시점 최신 문서로 재확인 필요

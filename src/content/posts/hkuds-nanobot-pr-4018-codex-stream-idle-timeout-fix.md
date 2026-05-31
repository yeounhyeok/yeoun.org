---
title: "HKUDS NanoBot PR #4018: Codex stream idle timeout 설정을 실제로 반영하게 만든 이야기"
published: 2026-05-31
description: "HKUDS NanoBot Codex provider가 NANOBOT_STREAM_IDLE_TIMEOUT_S를 존중하도록 수정한 upstream merged PR 기록."
lang: "ko"
draft: false
category: "AI Platform / Open Source"
tags: ["Open Source", "AI Agent", "NanoBot", "Codex", "Provider Stability", "Stream Timeout", "MLOps", "LLM Runtime", "Provider Layer", "Environment Variables"]
---

AI agent runtime에서 timeout은 사소한 설정처럼 보이지만, 실제 운영에서는 꽤 날카로운 문제다.

모델 응답이 길어지거나, reasoning 단계가 오래 걸리거나, 네트워크가 잠깐 느려지는 순간 stream이 먼저 끊기면 사용자는 “모델이 실패했다”고 느낀다. 그런데 더 골치 아픈 경우는 따로 있다.

> 환경변수로 timeout을 늘렸는데, 특정 provider에서는 그 값이 실제로 적용되지 않는 경우.

HKUDS NanoBot PR #4018은 바로 이 문제를 고친 작은 패치다. Codex provider가 `NANOBOT_STREAM_IDLE_TIMEOUT_S` 환경변수를 제대로 반영하도록 수정했다.

PR 자체는 크지 않다. 하지만 AI agent runtime / provider layer 관점에서는 꽤 중요한 운영성 개선이다.

## NanoBot과 Codex provider

NanoBot은 HKUDS에서 개발하는 AI agent / LLM application framework 계열 프로젝트다. 여러 provider와 agent 실행 흐름을 다루기 때문에, provider별 동작이 일관되게 맞춰지는 것이 중요하다.

여기서 Codex provider는 Codex 계열 모델 또는 Codex-compatible provider와 연결되는 실행 경로라고 보면 된다.

문제는 streaming 응답이다. LLM provider는 응답을 한 번에 반환하지 않고 token 또는 event 단위로 흘려보낼 수 있다. 이때 일정 시간 동안 아무 chunk도 오지 않으면 runtime은 stream이 멈췄다고 판단하고 timeout을 발생시킬 수 있다.

```text
사용자 요청
   |
   v
NanoBot runtime
   |
   v
Provider adapter
   |
   v
Codex streaming response
   |
   +-- chunk 도착
   +-- chunk 도착
   +-- 잠시 침묵
   +-- timeout 판단
```

이 timeout 값은 운영 환경마다 달라질 수밖에 없다.

- 긴 prompt를 처리하는 환경
- reasoning이 오래 걸리는 모델
- 네트워크 latency가 큰 환경
- self-hosted gateway를 거치는 환경
- 여러 provider를 한 runtime에서 섞어 쓰는 환경

그래서 NanoBot에는 `NANOBOT_STREAM_IDLE_TIMEOUT_S`라는 환경변수 기반 설정이 있었다. 이름 그대로 stream idle timeout을 초 단위로 조정하기 위한 설정이다.

## 문제: 설정은 있는데 Codex provider가 따르지 않음

기존 문제는 단순했다.

> `NANOBOT_STREAM_IDLE_TIMEOUT_S`를 설정해도 Codex provider 쪽에서는 그 값이 제대로 반영되지 않을 수 있었다.

운영자 입장에서는 꽤 피곤한 문제다.

```text
NANOBOT_STREAM_IDLE_TIMEOUT_S=120

기대:
  모든 streaming provider가 120초 idle timeout 기준을 따름

현실:
  Codex provider는 별도 기본값이나 하드코딩된 동작을 사용할 수 있음
```

이러면 같은 NanoBot runtime 안에서도 provider마다 timeout 정책이 달라진다.

<table>
  <thead>
    <tr><th>상황</th><th>운영자가 기대하는 동작</th><th>문제</th></tr>
  </thead>
  <tbody>
    <tr><td>환경변수로 timeout 증가</td><td>모든 provider에 동일 적용</td><td>Codex provider만 다르게 동작 가능</td></tr>
    <tr><td>긴 reasoning 응답</td><td>충분히 기다림</td><td>중간에 stream idle timeout 발생 가능</td></tr>
    <tr><td>provider 교체</td><td>동일 설정으로 운영</td><td>provider별 timeout 차이로 예측 어려움</td></tr>
  </tbody>
</table>

즉, 이 문제의 본질은 “timeout 숫자 하나”가 아니라 **runtime 설정과 provider adapter 사이의 계약이 깨진 것**에 가깝다.

## 수정 방향: provider가 전역 timeout 설정을 존중하게 만들기

PR #4018의 제목은 다음과 같다.

```text
fix(provider): honor NANOBOT_STREAM_IDLE_TIMEOUT_S in Codex provider
```

말 그대로 Codex provider가 `NANOBOT_STREAM_IDLE_TIMEOUT_S`를 honor, 즉 존중하도록 만든 패치다.

운영 관점에서 바뀐 점은 다음과 같다.

```text
Before
  NanoBot runtime에는 stream idle timeout 환경변수가 있음
  하지만 Codex provider 경로에서는 그 설정이 일관되게 반영되지 않음

After
  Codex provider도 NANOBOT_STREAM_IDLE_TIMEOUT_S를 기준으로 idle timeout을 제어
  streaming provider 간 timeout 동작이 더 일관됨
```

이런 패치는 코드 diff만 보면 작아 보일 수 있다. 하지만 provider abstraction을 다루는 프로젝트에서는 중요하다.

- 설정은 runtime 전체에 존재한다.
- provider adapter는 그 설정을 실제 호출 경로에 반영해야 한다.
- 운영자는 provider를 바꿔도 같은 설정 모델을 기대한다.

이 세 가지가 맞아야 운영자가 시스템을 예측할 수 있다.

## 왜 이게 AI Platform / MLOps 관점에서 중요한가

MLOps나 AI Platform에서 좋은 시스템은 단순히 “모델을 호출할 수 있다”에서 끝나지 않는다.

운영자가 배포 환경에서 정책을 조정할 수 있어야 한다.

```text
코드 수정 없이 바꿀 수 있어야 하는 것들
├─ timeout
├─ retry
├─ concurrency
├─ rate limit
├─ provider endpoint
└─ logging / tracing level
```

timeout은 이 중에서도 가장 기본적인 운영 파라미터다.

만약 timeout이 provider 내부에 숨어 있거나 하드코딩되어 있으면, 장애가 났을 때 선택지가 줄어든다.

```text
문제 발생:
  긴 응답에서 stream이 자주 끊김

설정 기반 시스템:
  환경변수 조정 → 재배포 → 관찰

하드코딩된 시스템:
  코드 수정 → PR → 리뷰 → 릴리즈 대기 → 재배포
```

운영에서는 이 차이가 크다. 특히 AI agent는 일반 API보다 응답 시간이 흔들리기 쉽다. tool call, reasoning, provider queue, 네트워크 지연이 모두 섞이기 때문이다.

그래서 이 PR의 핵심은 다음 문장으로 정리할 수 있다.

> Runtime behavior should be configurable through deployment-time configuration, not hardcoded provider-specific behavior.

런타임 동작은 provider 내부 하드코딩이 아니라, 배포 시점 설정으로 제어 가능해야 한다.

## 작은 PR이지만 좋은 기여인 이유

이 PR은 대규모 기능 추가가 아니다. UI가 바뀐 것도 아니고, 새로운 agent 기능이 생긴 것도 아니다.

하지만 운영성 관점에서는 방향성이 좋다.

### 1. provider 간 동작 일관성

여러 provider를 지원하는 프레임워크에서 가장 위험한 것은 “provider마다 미묘하게 다른 동작”이다.

```text
Provider A: timeout 환경변수 반영
Provider B: timeout 환경변수 무시
Provider C: 다른 이름의 설정 사용
```

이런 상태가 쌓이면 운영자는 provider별 예외를 외워야 한다. 그 순간 abstraction은 새는 추상화가 된다.

PR #4018은 Codex provider를 전체 설정 모델에 맞춰 provider abstraction의 구멍을 줄였다.

### 2. 장애 대응 옵션 증가

timeout을 환경변수로 제어할 수 있으면 장애 대응이 쉬워진다.

- 긴 응답이 필요한 워크로드에서는 timeout 증가
- 빠른 실패가 중요한 워크로드에서는 timeout 감소
- provider latency가 불안정한 시기에는 임시 완화
- 배포 환경별로 다른 timeout 정책 적용

코드 수정 없이 운영 파라미터로 대응할 수 있다는 게 중요하다.

### 3. AI agent runtime의 현실적인 안정성

AI agent는 단순 chat completion보다 실패 지점이 많다.

```text
사용자 입력
→ agent loop
→ planning / reasoning
→ tool call
→ provider streaming
→ 결과 조합
→ 후속 tool call
```

이 중 provider streaming timeout은 겉으로 보기엔 작은 문제지만, 사용자 경험에는 직접 영향을 준다. stream이 끊기면 전체 agent run이 실패처럼 보일 수 있다.

따라서 timeout 설정을 일관되게 적용하는 것은 agent runtime 안정성의 기본기다.

## 실제 PR 정보

GitHub API로 확인한 PR 정보는 다음과 같다.

<table>
  <tbody>
    <tr><td>Repository</td><td><code>HKUDS/nanobot</code></td></tr>
    <tr><td>PR</td><td><a href="https://github.com/HKUDS/nanobot/pull/4018">#4018</a></td></tr>
    <tr><td>Title</td><td><code>fix(provider): honor NANOBOT_STREAM_IDLE_TIMEOUT_S in Codex provider</code></td></tr>
    <tr><td>Author</td><td><code>yeounhyeok</code></td></tr>
    <tr><td>Status</td><td><strong>Merged</strong></td></tr>
    <tr><td>Created</td><td>2026-05-27 10:58:53 UTC</td></tr>
    <tr><td>Merged</td><td>2026-05-27 18:17:16 UTC</td></tr>
    <tr><td>Category</td><td>Provider stability / stream timeout / operational configurability</td></tr>
  </tbody>
</table>

## 외부 자동 레퍼런스는 어떻게 봐야 하나

PR #4018은 `big_model_radar` 계열 레포의 자동 생성 OpenClaw 생태 리포트에서 몇 차례 언급되었다.

다만 이 부분은 과장하면 안 된다. 유명 매체나 공식 생태계 리포트에 실린 것은 아니다. GitHub 활동을 수집해서 요약하는 개인/소규모 자동 봇 리포트에 포착된 것으로 보는 게 맞다.

확인한 레퍼런스는 다음과 같다.

- [gsscsd/big_model_radar #402](https://github.com/gsscsd/big_model_radar/issues/402)
- [ivanweng2077/big_model_radar #102](https://github.com/ivanweng2077/big_model_radar/issues/102)
- [JohnGao818/big_model_radar #21](https://github.com/JohnGao818/big_model_radar/issues/21)

자동 리포트는 PR #4018을 NanoBot 섹션의 진행 사항으로 언급했고, 요지는 다음과 같았다.

> Codex provider가 `NANOBOT_STREAM_IDLE_TIMEOUT_S` 환경변수를 무시하던 문제를 수정했고, streaming provider의 timeout 제어 동작을 통일해 운영성을 높였다.

내가 보기엔 이 표현이 이 PR의 의미를 꽤 정확히 잡고 있다. 핵심은 “기능 추가”가 아니라 **설정 유연성과 운영 가능성 개선**이다.

## 배운 점

이번 PR에서 얻은 교훈은 단순하다.

### 1. 환경변수는 문서가 아니라 실행 경로까지 연결되어야 한다

환경변수가 존재한다는 것과, 실제 provider 코드가 그 값을 사용하는 것은 다르다.

운영 설정은 다음 경로가 끝까지 이어져야 의미가 있다.

```text
환경변수
→ config loader
→ runtime config
→ provider adapter
→ 실제 network / stream call
```

중간에 한 단계라도 빠지면 운영자는 설정했다고 믿지만 시스템은 다르게 동작한다.

### 2. provider abstraction은 작은 불일치에서 깨진다

provider abstraction은 “모든 provider가 같은 기능을 완벽히 제공한다”는 뜻이 아니다. 하지만 최소한 공통 설정은 비슷한 의미로 동작해야 한다.

timeout처럼 기본적인 설정이 provider마다 다르면 운영 복잡도가 빠르게 올라간다.

### 3. 좋은 OSS 기여는 큰 기능만이 아니다

오픈소스 기여라고 하면 거대한 기능 추가를 떠올리기 쉽다. 하지만 실제 프로젝트 안정성은 이런 작은 패치들이 쌓여 좋아진다.

- 설정이 실제로 적용되게 만들기
- provider별 예외 줄이기
- timeout / retry / logging 같은 운영 파라미터 정리하기
- 문서와 코드의 동작 맞추기

이런 종류의 기여는 AI Platform / MLOps 방향성과 잘 맞는다. 모델을 잘 쓰는 것보다, 모델을 안정적으로 운영하는 쪽에 가깝기 때문이다.

## 포트폴리오 문장으로 정리하면

영문으로는 이렇게 적을 수 있다.

> Contributed a merged stability fix to HKUDS NanoBot, making the Codex provider respect `NANOBOT_STREAM_IDLE_TIMEOUT_S` for configurable stream idle timeout behavior.

조금 더 구체적으로는:

> Improved NanoBot’s Codex provider operational reliability by aligning stream idle timeout behavior with the global `NANOBOT_STREAM_IDLE_TIMEOUT_S` configuration, enabling consistent timeout control across streaming providers.

한국어로는 이렇게 정리할 수 있다.

> HKUDS NanoBot에 Codex provider 안정성 패치를 기여했습니다. `NANOBOT_STREAM_IDLE_TIMEOUT_S` 환경변수가 Codex streaming timeout에도 적용되도록 수정해 provider 간 timeout 제어 동작을 일관화했습니다.

## 결론

PR #4018은 작지만 방향성이 좋은 PR이다.

이 기여의 가치는 “유명 프로젝트에 큰 기능을 넣었다”가 아니다. 더 정확히는, **AI agent framework의 provider layer에서 운영 설정이 실제 runtime 동작으로 이어지지 않던 부분을 찾아 수정했다**는 점이다.

AI Platform 관점에서는 이런 감각이 중요하다.

```text
설정은 존재하는가?
그 설정은 실제 실행 경로에 연결되어 있는가?
provider별 동작은 일관적인가?
운영자가 코드 수정 없이 정책을 바꿀 수 있는가?
```

이번 PR은 이 질문들 중 하나를 작게나마 해결한 기록이다. 작지만 실제 upstream에 병합되었고, 자동 생태 모니터링 리포트에도 포착되었다. 포트폴리오에서는 “agent runtime/provider layer의 운영 이슈를 찾아 해결할 수 있다”는 근거로 남길 만하다.

## 참고 링크

- [HKUDS/nanobot PR #4018](https://github.com/HKUDS/nanobot/pull/4018)
- [gsscsd/big_model_radar #402](https://github.com/gsscsd/big_model_radar/issues/402)
- [ivanweng2077/big_model_radar #102](https://github.com/ivanweng2077/big_model_radar/issues/102)
- [JohnGao818/big_model_radar #21](https://github.com/JohnGao818/big_model_radar/issues/21)

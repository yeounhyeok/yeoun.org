---
title: "가비아 도메인을 Cloudflare로 위임해서 DNS 관리권 가져오기"
published: 2026-06-24
description: "가비아에서 구매한 moa.pics 도메인의 소유권은 유지한 채, Cloudflare 네임서버 위임으로 DNS 관리권만 가져온 과정을 정리했다."
tags:
  - Gabia
  - Cloudflare
  - DNS
  - Nameserver
  - Domain Onboarding
  - MOA-CREW
category: "Architecture / Network"
lang: "ko"
draft: false
---

# 가비아 도메인을 Cloudflare로 위임해서 DNS 관리권 가져오기

이번에 `moa.pics` 도메인을 가비아에서 구매한 상태에서, 실제 DNS 레코드 관리는 Cloudflare에서 하도록 옮겼다.

처음 헷갈리기 쉬운 지점은 “도메인을 Cloudflare로 가져온다”는 말이다. 실제로 한 일은 도메인 소유권 이전이 아니다.

```text
도메인 소유권/결제: 가비아 계정에 유지
DNS 관리: Cloudflare 계정으로 위임
방법: 가비아 네임서버를 Cloudflare 네임서버 2개로 교체
```

즉, 레지스트라(registrar)는 그대로 가비아이고, 권한 DNS(authoritative DNS)만 Cloudflare로 바꾼 구조다.

## 용어부터 정리

DNS 이관 작업은 단어가 비슷해서 사고가 나기 쉽다.

| 용어 | 의미 | 이번 작업에서의 상태 |
|---|---|---|
| Registrar | 도메인을 구매하고 소유권/결제를 관리하는 업체 | 가비아 |
| Registry / TLD | `.pics` 같은 최상위 도메인 레벨의 등록 시스템 | `.pics` authoritative NS에 반영 필요 |
| Authoritative DNS | 실제 레코드의 정답을 들고 있는 DNS | Cloudflare |
| Nameserver delegation | “이 도메인의 DNS는 어디에 물어보라”는 위임 정보 | 가비아 NS → Cloudflare NS로 변경 |

핵심은 이거다.

> 가비아에서 도메인을 산 상태라도, 네임서버를 Cloudflare로 바꾸면 A/CNAME/TXT/MX 같은 DNS 레코드는 Cloudflare에서 관리할 수 있다.

## 전체 흐름

이번 작업의 흐름은 이렇게 잡았다.

```text
1. Cloudflare에 moa.pics Zone 추가
2. Cloudflare가 발급한 네임서버 2개 확인
3. 가비아 관리자 화면에서 기존 가비아 NS를 제거하고 Cloudflare NS 2개만 남김
4. dig +trace로 .pics TLD 위임 상태 확인
5. Cloudflare activation check / Active 상태 확인
6. 이후 Cloudflare에서 DNS 레코드 관리
```

최종적으로 남아야 하는 네임서버는 아래 2개였다.

```text
kellen.ns.cloudflare.com
melissa.ns.cloudflare.com
```

## 왜 “추가”가 아니라 “교체”인가

중요한 포인트는 Cloudflare 네임서버를 기존 가비아 네임서버 옆에 추가하는 게 아니라, 기존 가비아 네임서버를 제거하고 Cloudflare 네임서버 2개만 남겨야 한다는 점이다.

잘못된 상태는 이런 모습이다.

```text
ns.gabia.co.kr
ns.gabia.net
ns1.gabia.co.kr
kellen.ns.cloudflare.com
melissa.ns.cloudflare.com
```

이렇게 5개가 같이 보이면, 어떤 resolver는 가비아 쪽에 묻고 어떤 resolver는 Cloudflare 쪽에 물을 수 있다. 레코드가 양쪽에 완전히 동일하게 복제되어 있지 않다면 서비스가 간헐적으로 깨질 수 있다.

이번 작업에서도 중간 상태에서 `.pics` TLD 기준으로 가비아 NS 3개와 Cloudflare NS 2개가 함께 보였다. 그래서 기준을 이렇게 잡았다.

```bash
dig +trace NS moa.pics
```

여기서 Cloudflare 2개만 보여야 최종 위임이 끝난 것으로 본다.

## 중간에 보였던 상태: 화면은 맞는데 TLD는 아직 섞여 있음

작업 중 가장 헷갈리는 순간은 이거였다.

```text
가비아 화면: Cloudflare 2개만 있음
TLD 조회: 가비아 3개 + Cloudflare 2개가 같이 보임
```

이 경우 가능성은 두 가지다.

1. 가비아 화면에는 2개만 보이지만 실제 레지스트리 반영이 아직 덜 됨
2. 가비아 쪽에서 이전 네임서버가 완전히 삭제되지 않은 상태

그래서 교수님께 요청할 때도 “다시 수정해주세요”가 아니라, 먼저 “가비아 화면에서 최종 네임서버가 Cloudflare 2개만 맞는지 확인 부탁드립니다”라고 물었다.

화면에 2개만 남아 있다면 교수님이 더 할 일은 거의 없다. 그때는 TTL과 레지스트리 반영을 기다리면 된다.

당시 확인 기준은 다음과 같았다.

```bash
# TLD authoritative delegation까지 추적
 dig +trace NS moa.pics

# 주요 public resolver에서 보는 값 확인
for s in 1.1.1.1 8.8.8.8 9.9.9.9; do
  echo "@$s"
  dig +short NS moa.pics @$s | sort
done
```

최종적으로는 `dig +trace`와 public resolver 조회 모두 Cloudflare 2개만 반환했다.

```text
kellen.ns.cloudflare.com
melissa.ns.cloudflare.com
```

이 상태가 되면 가비아 쪽 네임서버 변경은 완료된 것으로 봐도 된다.

## Cloudflare에서 Zone 추가 권한도 확인해야 한다

도메인을 Cloudflare에서 관리하려면 먼저 Cloudflare 계정에 Zone이 있어야 한다. API로 처리할 수도 있지만, 이때는 토큰 권한이 중요하다.

Zone 조회나 레코드 수정 권한과, 새 Zone을 계정에 추가하는 권한은 다르다.

필요한 작업은 대략 이렇다.

```bash
# 토큰이 살아있는지 확인
curl -sS   -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"   https://api.cloudflare.com/client/v4/user/tokens/verify

# Zone 존재 확인
curl -sS   -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"   'https://api.cloudflare.com/client/v4/zones?name=moa.pics'
```

만약 새 Zone 생성에서 이런 오류가 나오면 토큰 권한이 부족한 것이다.

```text
Requires permission "com.cloudflare.api.account.zone.create"
```

이 경우에는 둘 중 하나를 선택한다.

- Cloudflare UI에서 직접 `Add a site`로 도메인을 추가한다.
- 계정 단위 Zone 생성 권한이 있는 API Token이나 멤버 권한을 사용한다.

운영 관점에서는 UI로 Zone을 먼저 추가하고, 이후 DNS 레코드 관리는 Zone-scoped API Token으로 제한하는 편이 더 안전하다.

## 기존 DNS 레코드 복사는 먼저 해야 한다

네임서버를 바꾸면 기존 가비아 DNS 레코드는 더 이상 authoritative answer가 아니다. 그래서 이미 쓰던 서비스가 있다면 Cloudflare로 먼저 복사해야 한다.

특히 아래 레코드는 빠뜨리면 바로 장애가 난다.

```text
A / CNAME   홈페이지, API, 서비스 엔드포인트
MX          메일 수신
TXT         SPF, DKIM, DMARC, 소유권 인증
CAA         인증서 발급 정책
```

이번 케이스는 새 프로젝트 도메인 성격이 강했지만, 일반적으로는 “네임서버 변경 전 DNS 레코드 inventory”가 먼저다.

## 교수님께 전달한 핵심 문구

외부 소유자에게 요청할 때는 기술 설명보다 권한 경계를 명확히 하는 게 중요하다.

```text
교수님, moa.pics의 소유권과 결제는 가비아 계정에 그대로 두고,
DNS 관리만 제 Cloudflare 계정으로 위임하려고 합니다.

Cloudflare에서 발급된 네임서버 2개를 가비아 관리자 페이지에 등록해주시면,
이후 A, CNAME, TXT, SSL/Proxy 관련 설정은 제가 Cloudflare에서 관리할 수 있습니다.
```

그리고 네임서버 값은 이렇게 전달했다.

```text
1. kellen.ns.cloudflare.com
2. melissa.ns.cloudflare.com
```

문제 상황에서는 이렇게 좁혔다.

```text
가비아 설정 화면에서 최종 네임서버가 아래 2개만 남아있는지 확인 부탁드립니다.

1. kellen.ns.cloudflare.com
2. melissa.ns.cloudflare.com

혹시 ns.gabia.co.kr, ns.gabia.net, ns1.gabia.co.kr 이 같이 남아 있다면 삭제 부탁드립니다.
```

## 최종 판정 기준

이번 작업에서 배운 판정 기준은 단순하다.

```text
Cloudflare 2개만 보임 → 정상
가비아 3개 + Cloudflare 2개가 같이 보임 → 아직 미완료 또는 반영 지연
가비아 3개만 보임 → 아직 위임 전
```

확인은 `dig +trace`를 기준으로 잡는 게 좋다. 일반 resolver 캐시는 중간 상태를 늦게 보여줄 수 있기 때문이다.

```bash
dig +trace NS moa.pics
```

그리고 주요 resolver도 같이 보면 실제 사용자 관점의 전파 상태를 볼 수 있다.

```bash
for s in 1.1.1.1 8.8.8.8 9.9.9.9; do
  echo "@$s"
  dig +short NS moa.pics @$s | sort
done
```

## 정리

이번 작업은 복잡한 인프라 작업이라기보다, DNS 책임 경계를 정확히 넘기는 작업이었다.

```text
소유권은 가비아에 둔다.
네임서버 위임만 Cloudflare로 바꾼다.
기존 NS는 추가가 아니라 교체한다.
최종 판정은 dig +trace로 한다.
Cloudflare Active 전환은 TLD 위임이 정리된 뒤 확인한다.
```

DNS 이관에서 제일 위험한 건 명령어가 아니라 애매한 상태를 정상으로 착각하는 것이다. 특히 네임서버는 “등록했다”가 끝이 아니라, 상위 TLD에서 실제로 무엇을 authoritative로 보고 있는지까지 확인해야 한다.

이번 케이스의 결론은 명확했다.

> 가비아는 도메인 소유권을 유지하고, Cloudflare는 DNS 운영면을 맡는다. 그리고 `dig +trace`에서 Cloudflare 네임서버 2개만 남으면 위임은 끝난다.

---
title: "Nginx Proxy Manager 워커가 SIGSEGV로 죽던 12분간의 기록"
published: 2026-07-30
description: "Nextcloud 업그레이드 직후 모든 서비스가 502로 떨어졌다. 원인은 NPM 워커가 60초마다 SIGSEGV로 죽는 것이었고, 로그 교차 검증으로 추적한 과정을 정리했다."
lang: ko
draft: false
category: "DevOps / Troubleshooting"
tags: ["Homelab", "Nginx Proxy Manager", "OpenResty", "LuaJIT", "Docker", "DNS", "Uptime Kuma", "SIGSEGV", "Troubleshooting", "Nginx"]
---

# Nginx Proxy Manager 워커가 SIGSEGV로 죽던 12분간의 기록

Nextcloud를 업그레이드하려다 DOM Fatal 에러가 났다. 이미지를 올려서 해결하고 나니, 이번에는 `yeoun.org`가 502를 뱉었다. 하나를 고치면 다른 하나가 무너지는 전형적인 홈랩 연쇄 장애였다.

이 글은 Nextcloud 업그레이드 → NPM 워커 크래시 → DNS 이력 추적 → Uptime Kuma 패턴 매칭 → OpenResty 근본 원인까지, 로그를 따라가며 원인을 분리한 기록이다.

## 먼저 열어둘 개념들

- **Nginx Proxy Manager (NPM)**: nginx 기반의 리버스 프록시 관리 도구다. 웹 UI에서 도메인별로 프록시 호스트, SSL 인증서, 리다이렉트 규칙을 설정할 수 있다. 내부적으로 OpenResty(nginx + Lua 확장)를 사용한다.
- **OpenResty**: nginx에 LuaJIT을 통합한 버전이다. NPM은 OpenResty 위에서 돌아가며, 요청 처리 중 Lua 스크립트를 실행할 수 있다.
- **SIGSEGV (시그널 11)**: 프로세스가 접근 권한이 없는 메모리 주소를 참조했을 때 OS가 보내는 시그널이다. 흔히 "segfault"라고 부른다. C 수준의 메모리 손상, NULL 포인터 참조, 또는 LuaJIT의 JIT 컴파일된 코드 페이지 문제가 원인이 될 수 있다.
- **Docker embedded DNS (127.0.0.11)**: Docker가 컨테이너 내부에서 제공하는 DNS 리졸버다. 컨테이너 이름으로 IP를 찾을 수 있고, 외부 도메인은 호스트의 DNS로 포워딩한다. NPM은 이 DNS를 통해 백엔드 서비스의 IP를 resolving한다.
- **Uptime Kuma**: self-hosted 모니터링 도구다. 설정한 엔드포인트에 60초마다 HTTP 요청을 보내고 응답 코드를 기록한다. 이번 장애에서는 이 60초 주기가 segfault 패턴과 정확히 일치했다.

## 1. Nextcloud DOM Fatal → 컨테이너 재생성

시작은 Nextcloud 업그레이드였다. 33.0.3에서 `DOMNodeList::count()` 호출 시 Fatal 에러가 발생하고 있었다. PHP 8.4.16의 php84-dom 확장과 Alpine 3.22.4의 시그니처 불일치 문제였다. 해결하려면 이미지를 올려야 했다.

```bash
docker compose up -d nextcloud
```

컨테이너가 재생성되면서 Docker IP가 변경되었다. `occ upgrade`로 33.0.3 → 34.0.2 마이그레이션을 완료했고, 내부 `/status.php` 요청은 200 OK를 반환했다. Nextcloud는 정상이었다.

하지만 외부에서 `https://yeoun.org`로 접속하니 502 Bad Gateway가 떴다.

## 2. 502의 원인이 컨테이너가 아니라 워커였다

첫 반응은 "백엔드 컨테이너가 죽었나?"였다. 하지만 astro-blog 컨테이너(n4200:8084)는 정상이었고, NPM → 백엔드 내부 요청도 200 OK를 반환했다. NPM 컨테이너 자체도 `Up` 상태였다.

문제는 NPM의 nginx 워커 프로세스에 있었다. `fallback_error.log`를 확인하니:

```
2026/07/30 16:43:57 [alert] 202#202: worker process 327 exited on signal 11 (core dumped)
2026/07/30 16:44:58 [alert] 202#202: worker process 326 exited on signal 11 (core dumped)
2026/07/30 16:45:58 [alert] 202#202: worker process 329 exited on signal 11 (core dumped)
...
```

22회. 약 60초 간격으로. nginx 마스터 프로세스(PID 202)는 죽은 워커를 즉시 새로 fork했지만, 새 워커도 60초 안에 다시 죽었다.

`proxy-host-32_error.log`(yeoun.org 전용 에러 로그)는 **0 bytes**였다. 즉 vhost 레벨의 에러가 아니라, 워커 프로세스 자체가 요청을 받고 응답을 보내기 전에 죽었다는 뜻이다. 실제로 segfault 시각의 access log에 해당 요청 기록이 없었다 — 응답을 못 쓰고 크래시한 것이다.

## 3. DNS 에러 이력 추적

워커가 왜 죽는지 추적하기 위해, `fallback_error.log.1.gz`(rotated 로그)에서 이전 기록을 찾았다. NPM이 4일 전(7/26)에 기동된 이후부터 간헐적으로 DNS 문제가 있었다.

```
2026/07/24 07:22:55 [error] 324#324: send() failed (111: Connection refused) while resolving, resolver: 127.0.0.11:53
2026/07/25 22:39:22 [error] 276#276: unexpected DNS response for n4200.soay-quail.ts.net
```

NPM의 DNS resolver 설정은 `resolver 127.0.0.11 valid=10s;` — Docker embedded DNS를 통해 백엔드 IP를 resolving한다. 10초마다 캐시가 갱신되지만, 7/24부터 이미 간헐적 DNS 실패가 기록되어 있었다.

12분 전(16:31)에 Nextcloud 컨테이너를 재생성하면서 Docker IP가 변경되었다. NPM의 DNS 캐시가 갱신되는 타이밍에, 이미 누적되어 있던 DNS 불안정성이 겹쳤을 가능성이 있다.

DNS 문제 자체는 segfault를 직접 발생시키지 않는다. 하지만 OpenResty의 Lua 기반 요청 처리 루틴이 DNS resolver 콜백을 처리하는 과정에서, 4일간 누적된 worker 내부 상태와 맞물려 메모리 손상이 발생했을 가능성이 있다.

## 4. 60초 패턴 = Uptime Kuma 헬스체크

segfault가 60초마다 발생한다는 패턴을 발견했다. 이는 Uptime Kuma의 헬스체크 주기와 정확히 일치했다.

Uptime Kuma가 60초마다 `http://yeoun.org/`로 GET 요청을 보낸다. 정상 시에는 NPM이 200을 반환한다. 하지만 segfault가 시작된 후에는:

- 16:42:57 Uptime Kuma 요청 → 200 OK (마지막 정상 응답)
- 16:43:57 다음 요청 → **워커 segfault** (access log에 미기록 — 응답 전에 크래시)

워커는 요청 수신 → 처리 중(또는 직후)에 segfault로 종료되고, 마스터 프로세스가 새 워커를 fork하지만, 다음 60초 주기 요청이 오면 같은 경로로 다시 크래시하는 루프가 12분간 이어졌다.

segfault 구간(16:43~16:55) 동안 외부 요청도 확인했다. yeoun.org 접근 로그에 외부(Cloudflare) 요청은 0건이었고, 다른 vhost(immich, music 등)도 마찬가지였다. 즉 외부 트래픽이 segfault를 유발한 것이 아니라, 내부 헬스체크 요청이 손상된 워커를 반복 타격한 것이다.

## 5. 근본 원인: OpenResty 1.27.1.2 + LuaJIT

NPM v2.14.0은 OpenResty 1.27.1.2(2026-02-17 빌드)를 사용한다. NPM의 GitHub 릴리스 노트를 확인한 결과:

- **v2.15.0** (2026-05-31): OpenResty 1.29.2.5 + Lua 버전 변경
- **v2.15.1** (2026-06-03): **"Base image reverts to Lua v5.1.5"** — v2.15.0에서 Lua를 변경했다가 안정성 문제로 롤백

NPM 프로젝트 자체에서 OpenResty/Lua 조합의 불안정성을 인지하고 있었다. 4일간의 worker 누적 상태 + DNS 캐시 미스가 겹치면서, LuaJIT 기반 요청 처리 루틴에서 메모리 손상이 발생한 것으로 추정한다.

## 장애 타임라인

| 시각 (UTC) | 이벤트 |
|---|---|
| 7/24 07:22 | DNS 에러: `send() failed (111: Connection refused) while resolving, resolver: 127.0.0.11:53` |
| 7/25 22:39 | DNS 에러: `unexpected DNS response for n4200.soay-quail.ts.net` |
| 7/26 18:33 | NPM 컨테이너 기동 (v2.14.0, OpenResty 1.27.1.2) |
| **7/30 16:31** | **Nextcloud 컨테이너 재생성** (`docker compose up -d` — IP 변경 발생) |
| 7/30 16:33~35 | Nextcloud `occ upgrade` (33.0.3 → 34.0.2) |
| **7/30 16:43:57** | **첫 segfault** (Nextcloud 재생성 12분 후) |
| 7/30 16:43~16:55 | 22회 worker SIGSEGV, 약 60초 간격 |
| 7/30 16:55:53 | NPM 재시작 → segfault 중단 |
| 7/30 17:15 | NPM v2.15.1 업그레이드 (OpenResty 1.29.2.5) |
| 7/30 17:22 | 5분 모니터링 후 0건, 모든 프록시 정상 |

## 해결

### 즉시 복구

```bash
docker restart nginx-proxy-manager
```

재시작 한 번으로 segfault가 멈췄다. worker 상태가 초기화되었기 때문이다. 14분 후에도 0건이었다.

### 근본 조치: NPM v2.15.1 업그레이드

```bash
# 이미지 풀
docker pull jc21/nginx-proxy-manager:2.15.1

# compose.yml 백업
cp docker-compose.yml docker-compose.yml.bak.20260730

# 이미지 태그 pin
sed -i 's|image: jc21/nginx-proxy-manager$|image: jc21/nginx-proxy-manager:2.15.1|' docker-compose.yml

# 재생성
docker compose up -d
```

업그레이드 후 확인:

```
NPM version: 2.15.1
OpenResty: openresty/1.29.2.5
```

모든 프록시 정상 응답:

| 도메인 | 상태 |
|---|---|
| yeoun.org | 200 |
| nextcloud.yeoun.org | 302 (로그인 리다이렉트) |
| music.yeoun.org | 405 (GET 미지원, 정상) |
| immich.yeoun.org | 200 |
| vault.yeoun.org | 200 |

5분간 모니터링: segfault 0건.

## 왜 이렇게 했나

- **재시작만으로 끝내지 않고 업그레이드한 이유**: 재시작은 worker 상태를 초기화할 뿐, 근본 원인인 OpenResty 1.27.1.2의 불안정성은 그대로다. segfault가 재발하면 그때 업그레이드해야 하지만, 이미 v2.15.1에서 Lua 안정 버전으로 복귀한 것이 확인되었기 때문에 선제 적용했다.
- **이미지 태그를 pin한 이유**: `jc21/nginx-proxy-manager:latest`를 그대로 쓰면, 다음 NPM 업데이트 시 의도치 않은 breaking change가 들어올 수 있다. 특히 v2.15.0→v2.15.1에서 Lua를 롤백한 전례가 있으므로, 명시적으로 `:2.15.1`을 pin했다.
- **access log와 error log를 교차 검증한 이유**: segfault가 발생한 시각의 access log에 기록이 없다는 것은, 워커가 요청을 "받았지만 응답하기 전에 죽었다"는 증거다. 이 교차 검증 없이는 "요청이 안 들어와서 죽은 것"인지 "요청 처리 중에 죽은 것"인지 구분할 수 없다.

## 다음에 같은 문제를 만나면

1. `fallback_error.log`를 먼저 본다. NPM의 모든 vhost 에러 로그가 비어있어도 fallback에 segfault가 쌓여있을 수 있다.
2. segfault의 시간 간격을 측정한다. 규칙적인 간격이면 모니터링 도구(이 경우 Uptime Kuma)의 요청 주기와 교차 검증한다.
3. segfault 시작 시점 직전의 컨테이너/서비스 변경 이력을 확인한다. 컨테이너 재생성 → IP 변경 → DNS 캐시 미스 루트가 흔하다.
4. NPM 버전과 OpenResty 버전을 확인하고, GitHub 릴리스 노트에서 Lua/OpenResty 변경 이력을 찾는다.
5. 재시작으로 즉시 복구하되, 이미지 태그를 pin하고 안정 버전으로 업그레이드한다.
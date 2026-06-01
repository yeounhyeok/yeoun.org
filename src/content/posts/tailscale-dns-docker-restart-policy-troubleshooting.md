---
title: "Tailscale DNS 장애와 Docker restart policy 트러블슈팅"
published: 2026-06-01
description: "AdGuard Home이 죽으며 Tailscale DNS가 막힌 홈랩 장애를 Docker restart policy, 주간 재부팅 cron, Glances Docker stats polling 관점에서 분리한 트러블슈팅 기록."
lang: "ko"
draft: false
category: "DevOps / Troubleshooting"
tags: ["Homelab", "Docker", "Tailscale", "DNS", "AdGuard Home", "Glances", "Nginx Proxy Manager", "Cloudflared", "Restart Policy", "Troubleshooting"]
---

# Tailscale DNS 장애와 Docker restart policy 트러블슈팅

홈랩에서 DNS가 죽으면 체감 장애는 생각보다 크게 온다.

이번 장애는 단순히 “AdGuard Home 컨테이너가 꺼졌다”로 끝나는 문제가 아니었다. AdGuard Home은 Tailscale DNS의 내부 resolver 역할을 하고 있었고, 그 컨테이너가 내려가면서 Tailnet 내부 DNS 질의가 막혔다. 결과적으로 인터넷도, 내가 쓰는 에이전트 런타임도 같이 영향을 받았다.

이 글은 그 장애를 실제 로그를 따라가며 분리한 기록이다. 결론부터 말하면 원인은 세 겹이었다.

1. 매주 월요일 03:30에 실행되는 root crontab의 `safe-reboot.sh`가 Docker를 직접 내렸다.
2. `restart: unless-stopped` 컨테이너들이 재부팅 후 자동 복구되지 않았다.
3. 별도로 Docker 29.1.2의 `ContainerStats` 경로가 Glances Docker plugin에 의해 트리거되어 dockerd가 fatal crash를 냈다.

핵심 교훈은 단순하다.

> DNS, tunnel, reverse proxy처럼 장애 반경이 큰 서비스는 `unless-stopped`로 두면 안 된다.  
> 그리고 Docker daemon을 직접 stop하는 재부팅 스크립트는 restart policy와 충돌할 수 있다.

## 용어 정리

- **AdGuard Home**: 광고 차단과 DNS filtering을 제공하는 self-hosted DNS 서버다. 이번 구성에서는 Tailscale DNS의 upstream resolver 역할을 했다.
- **Tailscale DNS**: Tailnet 안의 클라이언트가 `100.100.100.100`을 통해 DNS 질의를 보내고, 관리 콘솔에 설정된 resolver로 넘기는 구조다.
- **Docker restart policy**: 컨테이너 종료 후 Docker가 다시 시작할지 결정하는 정책이다. 대표적으로 `always`, `unless-stopped`, `on-failure`가 있다.
- **Glances**: 서버 리소스를 보는 Python 기반 모니터링 도구다. Docker plugin을 켜면 Docker socket을 통해 컨테이너 stats stream을 계속 읽는다.
- **Hermes Agent**: 내가 쓰는 개인 AI 에이전트 런타임이다. Discord DM에서 요청을 받고 SSH, 터미널, 파일, 로그 조회 같은 도구를 호출해 홈서버를 진단할 수 있다.

## 증상

문제의 시작은 DNS였다.

```text
Tailscale DNS resolver: n4000 / 100.124.4.110
AdGuard Home: container exited
Port 53: listener 없음
```

장애 당시 `n4000`의 AdGuard Home 컨테이너는 내려가 있었고, `100.124.4.110:53`으로 직접 질의하면 연결이 거부됐다.

```bash
dig @100.124.4.110 google.com
```

결과는 정상 응답이 아니라 connection refused였다. Tailscale 입장에서는 DNS proxy인 `100.100.100.100`까지는 가더라도, 실제 upstream resolver가 죽어 있으니 Tailnet 클라이언트 전체가 DNS 장애를 체감할 수밖에 없다.

즉 장애 반경은 단일 컨테이너가 아니었다.

```text
AdGuard Home down
  -> n4000:53 down
  -> Tailscale DNS upstream failure
  -> Tailnet DNS failure
  -> 인터넷/에이전트/내부 서비스 접근 장애
```

## 1차 복구

우선 DNS부터 살렸다.

```bash
docker start adguardhome
```

이후 직접 DNS 질의를 다시 확인했다.

```bash
dig @100.124.4.110 google.com +short
```

정상적으로 Google IP들이 반환되면서 DNS 자체는 복구됐다.

이후 `n4000`에서 함께 내려가 있던 서비스들도 확인했다. AdGuard Home만 죽은 것이 아니라 여러 서비스가 동시에 `Exited` 상태였다.

```text
cloudflared
nginx-proxy-manager
jellyfin
navidrome
syncthing
navidrome-downloader
chatbot
```

반대로 `restart: always`로 보이는 일부 서비스는 자동 복구되어 있었다.

```text
immich_server
nextcloud
vaultwarden
redis
immich_redis
```

여기서 방향이 잡혔다. 앱 하나의 crash가 아니라 Docker daemon 또는 host lifecycle 이벤트를 봐야 했다.

## 처음에는 dockerd crash처럼 보였다

Docker journal에는 강한 로그가 있었다.

```text
dockerd[967]: fatal error: found pointer to free object
```

그리고 Docker가 다시 올라온 로그도 있었다.

```text
Started Docker Application Container Engine
```

그래서 처음에는 “dockerd fatal crash 이후 `unless-stopped` 상태가 꼬였나?”라고 봤다. 실제로 Docker 로그에는 다음 패턴도 있었다.

```text
ShouldRestart failed, container will not be restarted
restart canceled
hasBeenManuallyStopped=true
```

하지만 이 해석은 반만 맞았다. 더 앞단의 원인이 있었다.

## 진짜 1차 원인: root crontab의 safe-reboot.sh

root crontab을 확인하니 월요일 새벽 작업이 있었다.

```text
30 3 * * 1 /usr/local/bin/safe-reboot.sh
```

그리고 장애가 난 날은 월요일이었다. 실제 로그도 정확히 일치했다.

```text
03:30:01 CRON ... CMD (/usr/local/bin/safe-reboot.sh)
03:30:03 Stopping Docker Application Container Engine...
03:30:47 boot
```

스크립트 내용은 다음과 같았다.

```bash
#!/bin/bash
sync
sleep 2

systemctl stop docker.socket
systemctl stop docker

sleep 5
/sbin/shutdown -r now
```

즉 매주 월요일 03:30에 Docker socket과 Docker daemon을 먼저 내린 뒤, 5초 후 시스템을 재부팅하고 있었다.

문제는 이 지점이다.

Docker가 컨테이너를 직접 stop하고 daemon shutdown에 들어가면, restart policy는 일반적인 crash recovery처럼 동작하지 않는다. 실제 로그도 그렇게 말하고 있었다.

```text
ShouldRestart failed, container will not be restarted
container=...
daemonShuttingDown=true
error="restart canceled"
hasBeenManuallyStopped=false
```

이 로그는 “컨테이너 앱이 죽었다”가 아니다. Docker daemon이 내려가는 중이라 restart 판단 자체가 취소된 것이다.

## 왜 unless-stopped가 위험했나

`restart: unless-stopped`는 이름만 보면 안전해 보인다.

> 명시적으로 stop하지 않는 한 재시작한다.

하지만 운영 관점에서는 함정이 있다. Docker daemon이나 host lifecycle과 얽히면 “이 컨테이너가 정말 다시 떠야 하는가?”라는 판단이 `always`보다 보수적으로 흐를 수 있다. 특히 이번처럼 Docker를 명시적으로 stop한 뒤 재부팅하는 스크립트와 만나면, 핵심 서비스가 기대한 대로 자동 복구되지 않을 수 있다.

DNS, tunnel, reverse proxy는 일반 앱과 다르다.

```text
AdGuard Home       -> DNS 기반
cloudflared        -> 외부 터널 기반
Nginx Proxy Manager -> reverse proxy 기반
```

이 셋은 죽으면 다른 서비스가 정상이어도 사용자는 장애로 느낀다. 따라서 이 계층은 `unless-stopped`보다 `always`가 더 적합하다.

## 별도 문제: Docker 29.1.2와 Glances Docker plugin

`safe-reboot.sh`가 서비스 미복구의 1차 원인이었다면, dockerd fatal crash는 별도의 문제였다.

Docker 버전은 다음과 같았다.

```text
Docker Engine 29.1.2
Go 1.25.5
containerd 2.2.0
runc 1.3.4
```

fatal stack은 명확하게 Docker stats API 경로를 가리켰다.

```text
fatal error: found pointer to free object
github.com/moby/moby/v2/daemon.(*Daemon).ContainerStats
/root/build-deb/engine/daemon/stats.go:64
container_routes.go:164
```

즉 dockerd가 죽은 지점은 `/containers/{id}/stats` 계열이었다.

그 시점 Docker socket에 붙어 있던 유의미한 클라이언트는 systemd 서비스로 실행 중인 Glances였다.

```text
glances.service
ExecStart=/usr/bin/glances -s -B 127.0.0.1
```

Glances 설정도 Docker plugin이 켜져 있었다.

```ini
[docker]
disable=False
```

Glances 3.2.4.2의 Docker plugin은 컨테이너마다 stats stream thread를 만든다.

```python
self._stats_stream = container.stats(decode=True)
```

실제로 `glances` 프로세스가 Docker socket에 여러 fd로 붙어 있었다. 컨테이너 중 Docker socket을 bind mount한 모니터링 컨테이너는 없었다. 따라서 dockerd fatal crash의 트리거는 다음으로 보는 게 가장 자연스럽다.

```text
재부팅 후 dockerd 시작
  -> Glances 시작
  -> Glances Docker plugin이 컨테이너별 stats stream 생성
  -> Docker 29.1.2 ContainerStats 경로에서 Go runtime fatal
  -> dockerd crash
```

여기서 중요한 점은 Glances가 “잘못했다”기보다는, Docker daemon의 stats API 경로가 해당 조건에서 fatal을 낸 것이다. 다만 운영자는 트리거를 제거해야 한다. 안 쓰는 Glances라면 제거하는 게 맞다.

## zram이나 OOM은 아니었나

zram도 의심했다. 하지만 현재 증거상 이번 장애의 주 원인은 아니다.

확인 결과 실제 swap은 일반 swapfile이었다.

```text
/swapfile file 2G USED 0B
```

zram 설정 파일 흔적은 있었지만 실제 활성 zram 장치는 보이지 않았다. 또한 OOM kill 로그도 없었다. 따라서 이번 장애는 메모리 부족보다는 다음 두 가지로 보는 게 더 타당하다.

1. `safe-reboot.sh`와 Docker restart policy 충돌
2. Glances Docker plugin이 Docker 29.1.2 stats API crash를 트리거

## 조치

이번에 적용한 즉시 조치는 다음과 같다.

### 1. 내려간 서비스 복구

```bash
docker start adguardhome
# 이후 cloudflared, nginx-proxy-manager, jellyfin, navidrome, syncthing 등도 기동
```

검증은 DNS, HTTP, tunnel 순서로 했다.

```bash
dig @100.124.4.110 google.com +short
curl -I http://127.0.0.1:81
curl -I http://127.0.0.1:8096
```

Cloudflare Tunnel도 connectivity pre-checks가 PASS였다.

### 2. Glances 제거

안 쓰는 모니터링 도구였고, Docker socket stats stream을 계속 열고 있었기 때문에 제거했다.

```bash
sudo systemctl disable --now glances
sudo dpkg --purge glances
```

`apt-get purge glances`는 Samba 패키지 의존성 꼬임 때문에 실패했지만, `dpkg --purge glances`로 패키지와 설정을 제거했다. 이후 Docker socket에서 `glances` 클라이언트가 사라진 것을 확인했다.

### 3. 재발 방지 방향

아직 적용 전이거나 별도 작업으로 남긴 항목은 다음이다.

```yaml
services:
  adguardhome:
    restart: always
  cloudflared:
    restart: always
  nginx-proxy-manager:
    restart: always
```

그리고 `safe-reboot.sh`는 아래 중 하나로 바꾸는 게 맞다.

- Docker를 직접 stop하지 않는다.
- 주간 재부팅 자체를 제거한다.
- 꼭 필요하다면 systemd timer로 옮기고, 재부팅 후 핵심 서비스 health check를 붙인다.

예를 들어 DNS는 별도 watchdog을 둘 수 있다.

```bash
if ! dig @100.124.4.110 google.com +short >/dev/null; then
  docker start adguardhome
fi
```

물론 이 스크립트도 최종적으로는 systemd timer나 모니터링 파이프라인 안에서 제한적으로 실행하는 편이 낫다.

## 타임라인

```text
03:30:01 root cron이 safe-reboot.sh 실행
03:30:03 Docker daemon stop 시작
03:30:04~03:30:14 컨테이너들이 종료되고 restart canceled 로그 발생
03:30:47 시스템 부팅
03:30:51 Glances 시작
03:49:20 dockerd fatal error: found pointer to free object
이후 AdGuard Home 등 unless-stopped 컨테이너 미복구 상태 확인
수동으로 AdGuard Home 및 주요 서비스 복구
Glances 제거
```

## 배운 점

첫째, DNS는 단일 장애점으로 두면 안 된다. 특히 Tailscale DNS의 유일한 resolver가 홈서버 컨테이너 하나라면, 그 컨테이너는 일반 앱보다 훨씬 강한 복구 정책을 가져야 한다.

둘째, `unless-stopped`는 편하지만 핵심 인프라 계층에는 너무 약하다. 사용자가 명시적으로 끈 상태를 존중하는 정책은 데스크톱 앱이나 선택적 서비스에는 맞지만, DNS와 proxy에는 맞지 않는다.

셋째, “안전한 재부팅 스크립트”가 정말 안전한지 봐야 한다. Docker를 먼저 내리는 방식은 깔끔해 보이지만, 실제로는 Docker의 restart policy와 충돌할 수 있다. 재부팅은 systemd에게 맡기고, 재부팅 후 health check를 두는 편이 더 운영 친화적이다.

넷째, 모니터링 도구도 장애 원인이 될 수 있다. 특히 Docker socket을 읽는 도구는 단순 관찰자가 아니다. daemon API를 지속적으로 호출하는 클라이언트다. 안 쓰는 모니터링 도구는 제거하는 게 가장 좋은 hardening이다.

## 결론

이번 장애는 하나의 컨테이너 crash가 아니라, 운영 경계가 겹치며 생긴 장애였다.

```text
주간 재부팅 cron
  + Docker 직접 stop
  + unless-stopped 핵심 서비스
  + 단일 Tailscale DNS resolver
  + Glances Docker stats polling
```

각 요소는 단독으로는 그럴듯했다. 하지만 합쳐지니 DNS가 죽고, 인터넷이 막히고, 에이전트 런타임까지 영향을 받았다.

운영에서 중요한 건 “각 설정이 맞는가”보다 “설정들이 같이 만났을 때 어떤 실패 모드를 만드는가”다. 이번 사건은 그걸 꽤 선명하게 보여준 케이스였다.

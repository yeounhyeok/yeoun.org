---
title: "저사양 홈랩 k3s 전환기 01: Docker Compose에서 Agent GitOps로"
published: 2026-05-31
description: "Docker Compose 기반 홈랩을 k3s와 GitOps로 점진 전환해, AI Agent가 Pod 단위로 배포·조회·복구하기 쉬운 운영면을 만드는 첫 기록."
lang: "ko"
draft: false
category: "Architecture / Homelab"
tags: ["Homelab", "k3s", "Kubernetes", "GitOps", "AI Agent", "Docker Compose", "Cloudflare Tunnel", "Nginx Proxy Manager", "Pod", "n4000", "n4200"]
---

내 홈랩은 지금도 잘 굴러간다.  
Cloudflare Tunnel로 외부 트래픽을 받고, n4000의 Nginx Proxy Manager가 각 서비스로 라우팅한다. 서비스들은 대부분 Docker Compose로 관리한다.

문제는 “돌아간다”와 “운영하기 쉽다”가 다르다는 점이다.

컨테이너가 늘어날수록 운영 방식은 점점 이런 형태가 된다.

```bash
ssh n4000
cd /home/yeoun/docker_volumes/some-service
docker compose ps
docker compose logs
docker compose up -d
```

이 방식은 단순하고 직관적이다. 하지만 서비스가 10개, 20개로 늘어나면 상태 확인, 재시작, 롤백, 라우팅, 문서화가 모두 사람의 기억에 의존하기 시작한다.

이번 시리즈의 목표는 단순히 “쿠버네티스를 써보기”가 아니다.

> 목표는 홈랩 운영을 **선언형**, **재현 가능**, **Agent가 조작하기 쉬운 구조**로 바꾸는 것이다.

특히 중요한 목적이 하나 더 있다.

> AI Agent가 SSH로 각 서버에 들어가 수동 명령을 실행하는 수준을 넘어서, GitOps를 통해 Pod 단위로 서비스를 배포·조회·복구할 수 있는 운영면을 만드는 것.

즉, 사람과 Agent가 같이 다루기 쉬운 홈랩 플랫폼을 만드는 것이 이번 전환의 핵심이다.

---

## 현재 공개 진입 구조

현재 public ingress 구조는 다음과 같다.

```text
Internet
  ↓
Cloudflare DNS / Proxy
  ↓
Cloudflare Tunnel
  ↓
n4000 cloudflared container
  ↓
n4000 Nginx Proxy Manager
  ↓
각 노드 / 각 서비스
```

짧게 쓰면 이렇다.

```text
Cloudflare Tunnel → n4000 → NPM → 각 노드/서비스
```

이 구조의 장점은 명확하다.

- 공유기 포트포워딩을 최소화할 수 있다.
- `*.yeoun.org` 도메인을 Cloudflare에서 관리할 수 있다.
- public edge 역할을 n4000 + NPM으로 집중시킬 수 있다.
- 서비스가 어느 노드에 있든 NPM에서 라우팅만 바꾸면 된다.

예를 들어 Jellyfin은 다음 흐름으로 공개된다.

```text
jellyfin.yeoun.org
  ↓
Cloudflare Tunnel
  ↓
n4000 NPM
  ↓
http://n4000.soay-quail.ts.net:8096
```

여기서 중요한 점은, 내부망에서 접속된다고 해서 public으로 열린 것이 아니라는 점이다.  
외부 노출에는 Cloudflare DNS record와 NPM route가 둘 다 필요하다.

---

## 현재 노드 상태

전환을 시작하기 전에 먼저 현실적인 리소스를 확인했다.  
홈랩 장비는 고성능 서버가 아니라 저전력 미니 PC 중심이다.

### n4000

```text
CPU: Intel Celeron N4000 / 2 cores
RAM: 5.6 GiB
Disk: 114G 중 65G 사용, 43G 여유
Docker containers: 13개
Load average: 0.77, 0.64, 0.65
Swap: 2.0 GiB 중 약 819 MiB 사용
```

주요 역할:

- Cloudflare Tunnel
- Nginx Proxy Manager
- Jellyfin
- Navidrome
- Nextcloud
- Immich
- Vaultwarden
- AdGuard
- Syncthing
- 기타 작은 서비스

n4000은 사실상 현재 홈랩의 public ingress이자 media/service 노드다.  
이미 역할이 많기 때문에 여기에 k3s control-plane까지 얹는 것은 가능하더라도 여유롭지는 않다.

### n4200

```text
CPU: Intel Pentium N4200 / 4 cores
RAM: 3.7 GiB
Disk: 114G 중 42G 사용, 67G 여유
Docker containers: 7개
Load average: 0.12, 0.14, 0.13
Swap: 5.5 GiB 중 약 1.5 GiB 사용
```

주요 역할:

- Astro/Fuwari 블로그
- Homepage
- Quartz
- Syncthing
- Vikunja
- Home Assistant
- Matter server

n4200은 RAM은 작지만 CPU 코어가 4개이고 현재 load가 낮다.  
따라서 초기 k3s control-plane 후보로는 n4000보다 n4200이 더 적절해 보인다.

### zram

각 노드에는 zram 세팅을 해두었다.  
저사양 장비에서 swap 압박을 줄이는 데 도움이 되지만, 이것이 RAM 부족을 근본적으로 해결해주는 것은 아니다.

k3s 자체는 가볍지만, 다음 요소들이 붙으면 메모리 사용량은 빠르게 늘어난다.

- k3s server/control-plane
- ingress controller
- metrics-server
- Argo CD 또는 Flux
- Prometheus/Grafana/Loki 같은 observability stack

따라서 이 전환은 “클러스터니까 다 올리자”가 아니라, **가볍게 시작해서 검증하면서 확장하는 방식**이어야 한다.

---

## 왜 Kubernetes인가?

Docker Compose는 훌륭하다.  
특히 단일 노드에서 소수의 서비스를 돌릴 때는 Kubernetes보다 훨씬 간단하다.

하지만 내 홈랩은 점점 단일 노드 운영을 넘어가고 있다.

- 서비스가 여러 노드에 흩어져 있다.
- public ingress는 n4000에 집중되어 있다.
- AI/RAG/자동화 실험 서비스가 계속 생긴다.
- 장애가 났을 때 Agent가 상태를 확인하고 조치해야 한다.
- 운영 상태를 Git으로 남기고 싶다.

이 상황에서는 Kubernetes, 정확히는 k3s가 꽤 매력적인 선택지가 된다.

Kubernetes를 쓰면 다음처럼 상태 확인 방식이 표준화된다.

```bash
kubectl get pods -A
kubectl logs -n media deploy/jellyfin
kubectl describe pod -n infra some-pod
kubectl rollout restart deploy/some-app -n apps
kubectl rollout status deploy/some-app -n apps
```

Agent 입장에서도 이 구조는 다루기 쉽다.  
각 서버의 임의 디렉터리에 들어가 Compose 파일을 찾는 것보다, Kubernetes API를 통해 Pod, Deployment, Service, Ingress 상태를 조회하는 편이 훨씬 구조적이다.

---

## Agent GitOps라는 목적

이번 전환에서 내가 특히 중요하게 보는 것은 GitOps다.

직접 `kubectl edit`로 운영하는 구조는 편하지만, 장기적으로는 또 다른 수동 운영이 된다.  
내가 원하는 방향은 다음에 가깝다.

```text
Git repository = 원하는 상태
k3s cluster    = 실제 상태
Argo CD/Flux   = 동기화 관리자
Agent          = 변경 제안, manifest 수정, 상태 검증, 복구 보조
```

즉 Agent가 직접 서버에 들어가 이것저것 만지는 대신, Git 저장소에 선언형 변경을 만들고 그 변경이 클러스터에 반영되도록 하는 구조다.

예상 운영 흐름은 다음과 같다.

```text
1. 새 서비스를 배포하고 싶다.
2. Agent가 Helm values 또는 Kubernetes manifest를 작성한다.
3. Git diff로 변경사항을 확인한다.
4. Git에 반영한다.
5. Argo CD가 클러스터에 동기화한다.
6. Agent가 kubectl로 rollout/status/logs를 검증한다.
```

이렇게 하면 Agent가 더 안전하게 운영에 참여할 수 있다.

- 변경 이력이 Git에 남는다.
- 롤백 지점이 명확하다.
- live cluster에 대한 임의 조작이 줄어든다.
- 서비스 상태를 Pod/Deployment 단위로 표준화해서 확인할 수 있다.

이 시리즈의 목적은 결국 이것이다.

> 홈랩을 AI Agent가 이해하고 조작할 수 있는 선언형 운영 플랫폼으로 바꾸기.

---

## 전면 전환은 하지 않는다

그렇다고 기존 Docker Compose 서비스를 바로 전부 k3s로 옮기지는 않을 것이다.

특히 다음 서비스들은 당분간 Docker Compose에 남겨두는 것이 맞다.

```text
Jellyfin
Navidrome
Immich
Nextcloud
Home Assistant
AdGuard
Vaultwarden
Syncthing
DB가 붙은 서비스들
대용량 볼륨을 사용하는 서비스들
```

이유는 단순하다.  
이 서비스들은 상태와 데이터가 무겁다.

- 미디어 볼륨
- 사진/영상 업로드 데이터
- DB
- 파일 권한
- 백업
- 외부 연동
- 사용자 계정

이런 것들이 얽혀 있는 서비스를 성급하게 Kubernetes로 옮기면, 기술적으로는 배울 게 많아도 운영 안정성은 오히려 떨어질 수 있다.

따라서 초기 목표는 기존 서비스를 갈아엎는 것이 아니다.

> 기존 Docker Compose 운영은 유지하고, k3s는 신규 서비스와 실험 서비스를 위한 새 배포면으로 도입한다.

---

## 초기 전환 계획

현재 기준의 현실적인 계획은 다음과 같다.

### Phase 0. 현재 상태 문서화

- 노드별 사양 정리
- 현재 Docker Compose 서비스 목록 정리
- Cloudflare Tunnel → n4000 → NPM 구조 문서화
- 서비스별 public/private 노출 방식 정리

### Phase 1. n4200 단일 노드 k3s 설치

초기 control-plane은 n4200을 후보로 둔다.

이유:

- n4000보다 CPU 코어가 많다.
- 현재 load가 낮다.
- public ingress/media 역할이 n4000에 이미 몰려 있다.

단, RAM이 3.7 GiB라서 Argo CD나 monitoring stack은 매우 신중하게 올린다.

### Phase 2. 테스트 앱 배포

처음부터 중요한 서비스를 옮기지 않는다.

대상은 이런 것들이다.

```text
작은 FastAPI 앱
Webhook receiver
정적 대시보드
개발용 preview app
RAG 실험용 backend
```

조건은 명확하다.

```text
DB 없음
대용량 볼륨 없음
장애 나도 복구 쉬움
상태 저장 거의 없음
```

### Phase 3. n4000 NPM에서 k3s 앱으로 라우팅

public ingress는 당분간 기존 구조를 유지한다.

```text
Cloudflare Tunnel
  ↓
n4000 NPM
  ↓
k3s Ingress / NodePort / LoadBalancer
  ↓
Pod
```

처음부터 NPM을 제거하지 않는다.  
NPM은 이미 public edge router로 잘 작동하고 있으므로, k3s는 그 뒤쪽에 붙이는 형태로 시작한다.

### Phase 4. GitOps 저장소 구성

예상 구조는 다음과 같다.

```text
homelab-gitops/
  clusters/
    home/
  apps/
    test-api/
    webhook-receiver/
    dashboard/
  infrastructure/
    ingress/
    metrics-server/
    argocd/
```

GitOps 도구는 Argo CD와 Flux 중에서 선택할 수 있다.  
현재 생각으로는 Argo CD가 더 적합하다.

이유:

- UI로 상태를 보기 쉽다.
- 포트폴리오/시연에 좋다.
- 애플리케이션 단위 동기화 개념이 직관적이다.

다만 리소스가 제한적이므로, Argo CD를 올리기 전에 실제 메모리 여유를 다시 확인해야 한다.

### Phase 5. 신규 서비스는 k3s 우선 배포

어느 정도 안정화되면 신규 서비스는 기본적으로 k3s에 올린다.

기존 Docker Compose는 “레거시 운영면”으로 유지하고, k3s는 “새 배포 플랫폼”으로 사용한다.

### Phase 6. 작은 기존 서비스부터 선별 이관

충분히 익숙해진 뒤, 상태가 가벼운 서비스부터 이관을 검토한다.

예상 후보:

```text
작은 대시보드
Webhook류 서비스
단순 API 서버
개발용 앱
일부 관측 도구
```

반대로 Nextcloud, Immich, Jellyfin 같은 서비스는 마지막까지 신중하게 본다.

---

## 성공 기준

이번 전환의 성공 기준은 “모든 서비스를 Kubernetes로 옮겼다”가 아니다.

오히려 성공 기준은 다음에 가깝다.

- 새 서비스를 GitOps로 배포할 수 있다.
- Agent가 manifest를 수정하고 rollout을 검증할 수 있다.
- public ingress와 내부 서비스 라우팅이 문서화되어 있다.
- 장애 시 Pod/Deployment/Service 단위로 상태를 확인할 수 있다.
- 기존 Docker Compose 서비스는 안정적으로 유지된다.
- 무리한 이관으로 운영 안정성을 해치지 않는다.

즉, 목표는 Kubernetes 자체가 아니라 운영면의 개선이다.

---

## 첫 결론

현재 장비 사양은 k3s를 전혀 못 돌릴 수준은 아니다.  
다만 전체 홈랩을 한 번에 Kubernetes로 옮길 체급도 아니다.

그래서 방향은 명확하다.

```text
기존 안정 서비스: Docker Compose 유지
신규/실험 서비스: k3s + GitOps
public ingress: Cloudflare Tunnel → n4000 NPM 유지
Agent 운영: GitOps 변경 제안 + kubectl 검증 중심
```

이 방식이면 홈랩을 무리하게 갈아엎지 않으면서도, 점진적으로 선언형 운영 구조로 넘어갈 수 있다.

다음 글에서는 실제로 k3s를 어디에 설치할지, control-plane 후보를 어떻게 정할지, 그리고 n4200 단일 노드에서 최소 구성으로 시작할 때 어떤 옵션을 꺼야 하는지 정리해볼 예정이다.

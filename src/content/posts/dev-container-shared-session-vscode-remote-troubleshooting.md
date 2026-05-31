---
title: "개발 컨테이너는 공유하되, 세션은 공유하지 말자"
published: 2026-05-31
description: "VS Code Dev Containers를 여러 사람이 하나의 컨테이너에 동시에 붙여 쓰려다 발생한 ECONNRESET, ECONNREFUSED, 포트 포워딩 오류를 분석하고 사용자별 컨테이너 분리 원칙으로 정리한 트러블슈팅 기록."
lang: "ko"
draft: false
category: "DevOps / Troubleshooting"
tags: ["Dev Container", "VS Code Remote", "Docker", "Port Forwarding", "CUDA", "Development Environment", "Troubleshooting", "Remote Development"]
---

연구실 개발 서버에서 CUDA 개발환경을 공유하다가 작은 사건이 있었다.

한 명이 VS Code Remote로 개발 컨테이너에 붙어 있을 때는 멀쩡했다. 그런데 다른 사람이 같은 컨테이너에 동시에 접속하자, 기존에 붙어 있던 쪽의 VS Code가 끊겼다. 반대로 순서를 바꿔도 마찬가지였다.

처음에는 단순한 네트워크 끊김처럼 보였다. VS Code에는 흔히 보는 메시지가 떴다.

```text
연결이 끊겼습니다
창 다시 로드
```

하지만 로그를 보면 이건 그냥 와이파이가 흔들린 문제가 아니었다. VS Code Remote / Dev Containers가 내부적으로 만드는 포트 포워딩 경로가 끊기고, 재연결 과정에서 컨테이너 내부의 VS Code Server 쪽 포트 연결이 거절되고 있었다.

이 글은 그 상황을 정리한 짧은 트러블슈팅 기록이다. 핵심 결론은 단순하다.

> 개발 컨테이너의 이미지는 공유해도 된다.  
> 하지만 실행 중인 컨테이너와 VS Code Remote 세션은 사람마다 분리하는 편이 안전하다.

## 상황

구성은 대략 이랬다.

```text
사용자 A의 VS Code
  -> 원격 서버
  -> 공유 Dev Container
  -> VS Code Server / 포트 포워딩 세션

사용자 B의 VS Code
  -> 원격 서버
  -> 같은 공유 Dev Container
  -> 같은 컨테이너 내부의 VS Code Server 자원
```

컨테이너 자체는 CUDA 개발환경용이었다. 예전에 만들어둔 Dockerfile 기반 이미지가 있었고, 여러 사람이 같은 개발 서버에서 연구/실험 환경으로 쓰려는 상황이었다.

관련 Dockerfile은 아래 레포에 정리해두었다.

```text
https://github.com/yeounhyeok/cuda13_dev_container
```

처음에는 “한 컨테이너를 같이 쓰면 디스크도 아끼고 환경도 동일하니 편하지 않을까?”라고 생각할 수 있다. 실제로 한 명씩 쓸 때는 큰 문제가 없어 보인다. 문제는 **동시에 붙는 순간** 드러났다.

## 증상

동료가 먼저 말했다.

> “한 명 들어가면 한 명이 튕겨요. 역도 성립해요.”

이 말이 중요했다. 특정 사용자 한 명의 PC, 특정 계정, 특정 네트워크만의 문제가 아니라는 뜻이다. A가 먼저 접속한 뒤 B가 들어오면 A가 끊기고, B가 먼저 접속한 뒤 A가 들어오면 B가 끊긴다.

즉 문제의 범위는 클라이언트 한쪽이 아니라, **공유 컨테이너와 그 안에서 동작하는 Remote 세션 구조** 쪽으로 좁혀진다.

VS Code 로그에서는 다음 패턴이 반복됐다.

```text
Port forwarding ... stderr: Error: read ECONNRESET
Remote close with error
Reconnecting CLIHost with ExecServer.
Container: Reconnecting Dev Container server
Error: connect ECONNREFUSED 127.0.0.1:46253
```

특히 눈에 띄는 부분은 두 가지다.

```text
Error: read ECONNRESET
```

그리고 재연결 과정에서 반복되는 이 에러다.

```text
Error: connect ECONNREFUSED 127.0.0.1:46253
```

앞의 `ECONNRESET`은 이미 열려 있던 TCP 연결이 반대편에서 끊겼다는 의미에 가깝다. 뒤의 `ECONNREFUSED`는 접속하려는 대상 포트에 현재 받아주는 프로세스가 없거나, 기대한 서버가 더 이상 정상적으로 듣고 있지 않다는 뜻이다.

여기서는 VS Code Remote가 컨테이너 내부에서 잡아둔 포트 포워딩/서버 경로가 끊기고, 이후 같은 포트로 재접속하려 하지만 이미 그 세션이 살아 있지 않거나 다른 상태로 바뀐 것으로 볼 수 있다.

## 처음 떠올린 가설

처음에는 단순히 “포트 하나가 두 목적지를 동시에 감당하지 못하는 것 아닌가?”라고 생각했다.

대화 중에는 이렇게 설명했다.

```text
컨테이너에 포트가 있는데,
그 포트가 동시에 두 클라이언트의 목적지를 안정적으로 감당하지 못하고,
다른 사람이 들어오면서 포워딩 목적지가 바뀌어 끊기는 것 같다.
```

엄밀히 말하면 Docker의 일반적인 포트 바인딩 자체가 “한 포트는 한 IP만 감당한다”는 식으로 단순하게 동작하는 것은 아니다. 하나의 서버 포트에는 여러 TCP 클라이언트가 동시에 붙을 수 있다.

하지만 이 상황은 일반적인 웹 서버 포트가 아니었다. VS Code Dev Containers가 내부적으로 띄우는 VS Code Server, Exec Server, 포트 포워딩 경로, 클라이언트별 Remote 세션이 얽힌 문제였다.

그래서 더 정확한 표현은 이렇다.

> 단순 Docker 포트 문제가 아니라, 하나의 실행 중인 Dev Container 안에서 여러 VS Code Remote 클라이언트가 같은 Remote Server/포트 포워딩 자원을 공유하려 하면서 세션이 불안정해진 문제에 가깝다.

## 왜 IP나 계정 설정으로는 해결하기 어려운가

중간에 “연구실 수동 IP를 같은 값으로 맞추면 되느냐”는 질문도 나왔다.

하지만 그건 본질적인 해결책이 아니다. 문제의 핵심은 연구실 IP가 아니라, 각 사용자의 VS Code 클라이언트가 서로 다른 위치에서 같은 컨테이너 내부 세션 자원을 공유하려는 구조다.

```text
사용자 A의 노트북/집 네트워크
  -> 원격 서버
  -> 공유 컨테이너
  -> VS Code Remote 세션 A

사용자 B의 PC/다른 네트워크
  -> 원격 서버
  -> 같은 공유 컨테이너
  -> VS Code Remote 세션 B
```

IP를 맞춘다고 해서 VS Code Remote가 만들어둔 내부 서버 상태, 포트 포워딩 경로, 확장 프로세스, 워크스페이스 상태가 사용자별로 깔끔하게 분리되는 것은 아니다.

계정도 마찬가지다. 같은 Linux 계정으로 붙으면 오히려 `~/.vscode-server` 같은 사용자 홈 아래 상태를 더 강하게 공유하게 된다. 다른 계정을 쓰는 것은 분리 관점에서 도움이 될 수 있지만, 그래도 하나의 실행 중인 컨테이너를 여러 사용자가 동시에 VS Code Remote 세션으로 공유하는 구조 자체는 여전히 불안정할 수 있다.

## 정석에 가까운 해결책: 컨테이너를 사람마다 분리하기

결론은 컨테이너를 따로 파는 것이다.

```text
사용자 A
  -> user-a-dev-container

사용자 B
  -> user-b-dev-container

사용자 C
  -> user-c-dev-container
```

공유해야 하는 것은 실행 중인 컨테이너가 아니다. 공유해야 하는 것은 다음에 가깝다.

- 공통 Dockerfile
- 공통 베이스 이미지
- CUDA / PyTorch / Python 버전
- 프로젝트 코드 저장소
- 필요한 데이터셋 또는 공용 볼륨

즉, **이미지는 공유하고 세션은 분리한다.**

구조를 그림으로 쓰면 이렇게 된다.

```text
공통 Dockerfile / 공통 이미지
        |
        +--> user-a-cuda-dev 컨테이너
        |       +--> /workspace/user-a
        |
        +--> user-b-cuda-dev 컨테이너
        |       +--> /workspace/user-b
        |
        +--> user-c-cuda-dev 컨테이너
                +--> /workspace/user-c
```

이렇게 하면 각자의 VS Code Server, 포트 포워딩, 확장 상태, 터미널 세션이 서로 다른 컨테이너 안에서 관리된다. 누군가 접속하거나 재연결한다고 해서 다른 사람의 Remote 세션을 건드릴 가능성이 줄어든다.

## 예시 실행 구조

실제 명령은 서버 정책과 Dockerfile에 맞게 조정해야 하지만, 방향은 이런 식이다.

```bash
docker build -t cuda13-dev:latest .
```

사용자별 컨테이너를 따로 띄운다.

```bash
docker run -dit \
  --name user-a-cuda-dev \
  --gpus all \
  -v /home/guest/workspaces/user-a:/workspace \
  cuda13-dev:latest
```

다른 사용자도 별도 컨테이너를 가진다.

```bash
docker run -dit \
  --name user-b-cuda-dev \
  --gpus all \
  -v /home/guest/workspaces/user-b:/workspace \
  cuda13-dev:latest
```

만약 SSH나 웹 UI처럼 외부로 노출해야 하는 포트가 있다면, 사용자별로 포트를 다르게 잡아야 한다.

```bash
docker run -dit \
  --name user-a-cuda-dev \
  --gpus all \
  -p 10022:22 \
  -v /home/guest/workspaces/user-a:/workspace \
  cuda13-dev:latest


docker run -dit \
  --name user-b-cuda-dev \
  --gpus all \
  -p 10023:22 \
  -v /home/guest/workspaces/user-b:/workspace \
  cuda13-dev:latest
```

핵심은 포트 번호 자체보다 경계다.

> 컨테이너, 홈 디렉터리, VS Code Server 상태, 포트 포워딩 세션을 사용자별로 분리한다.

## 팀 개발환경에서 가져갈 원칙

이번 문제는 규모가 큰 장애는 아니었다. 하지만 팀 단위 원격 개발환경을 만들 때 자주 놓치는 경계를 보여준다.

### 1. 컨테이너 이미지는 공유 대상이다

Dockerfile, 베이스 이미지, CUDA 버전, Python 패키지 설치 방식은 공유하는 것이 좋다. 그래야 “내 컴퓨터에서는 되는데요”를 줄일 수 있다.

### 2. 실행 중인 개발 세션은 공유 대상이 아니다

VS Code Remote 세션, 터미널, 포트 포워딩, 확장 프로세스는 개인 작업 상태에 가깝다. 이걸 여러 사람이 한 컨테이너 안에서 공유하면 디버깅하기 어려운 충돌이 생길 수 있다.

### 3. 데이터는 볼륨으로 공유한다

공용 데이터셋이나 체크포인트가 필요하면 컨테이너 자체를 공유하지 말고 볼륨을 공유하는 편이 낫다.

```text
/shared/datasets
/shared/checkpoints
```

그리고 각 컨테이너에서 읽기 전용 또는 권한을 제한해 마운트한다.

```bash
-v /shared/datasets:/datasets:ro
```

### 4. 포트는 명시적으로 할당한다

Jupyter, TensorBoard, SSH, 웹 UI 같은 포트는 사용자별로 겹치지 않게 잡아야 한다.

```text
user-a: 11000~11099
user-b: 11100~11199
user-c: 11200~11299
```

이런 식으로 범위를 정해두면 운영자가 추적하기 쉽다.

## 정리

이번 트러블슈팅의 결론은 단순했다.

> Dev Container는 환경을 공유하기 위한 도구이지, 여러 사람의 VS Code Remote 세션을 한 컨테이너 안에 억지로 합치기 위한 도구가 아니다.

물론 상황에 따라 하나의 컨테이너에 여러 프로세스와 여러 사용자가 들어갈 수는 있다. 하지만 VS Code Remote / Dev Containers 기반의 개발 경험까지 안정적으로 공유하려면 이야기가 달라진다.

팀이나 연구실에서 GPU 개발 서버를 공유한다면, 나는 다음 구조를 기본값으로 둘 것 같다.

```text
공통 Dockerfile
공통 베이스 이미지
사용자별 컨테이너
사용자별 VS Code Remote 세션
공용 데이터는 볼륨으로만 공유
```

작은 차이지만 운영 안정성은 꽤 달라진다.

컨테이너는 공유해도 된다.  
하지만 세션은 공유하지 않는 편이 좋다.

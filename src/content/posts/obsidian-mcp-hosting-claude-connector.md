---
title: "Obsidian 볼트를 Claude에 붙이기 — MCP 직접 호스팅부터 연결까지"
published: 2026-07-31
description: "Obsidian 볼트를 리모트 MCP 서버로 호스팅하고 Cloudflare + NPM 뒤에서 OAuth 2.0 인증을 통과시켜 Claude 웹·모바일·CLI에 연결한 전체 과정. Hermes(GLM-5.2)와 Claude(Sonnet 5/Opus 4.8)의 에이전틱 AI 역할 비교 포함."
tags:
  - MCP
  - Claude
  - Cloudflare
  - OAuth
  - Obsidian
  - Hermes
  - AI Agent
category: "DevOps / Infrastructure"
lang: "ko"
draft: false
---

> ⬆️ **🗺️ 개발·인프라·홈랩 MOC** · 관련 → **Claude 플랫폼 통합 - Obsidian MCP 배포 핸드오프 (2026-08-01)**

## 왜 이걸 했나

Obsidian 볼트는 내 "제2의 뇌"다. 연구 메모, 인프라 결정 기록, 일정, 취미 분석까지 전부 들어있다. 문제는 이걸 AI와 대화할 때 쓰기 어렵다는 것.

- **Claude Desktop**은 로컬에서 Obsidian.app이 켜져 있어야 접근 가능 — 모바일에서는 안 됨
- **그냥 복붙**? 컨텍스트가 길어지면 한계가 명확
- **Hermes(ROLEX)**는 SSH로 볼트 파일을 직접 읽을 수 있지만, Claude 생태계와는 별개

원하는 건 단순하다: **Claude 앱(웹·데스크톱·모바일 어디서든)에서 내 볼트를 컨텍스트로 읽고 대화할 수 있을 것.**

Anthropic의 **커스텀 커넥터(Custom Connector)** 기능이 정확히 이 문제를 푼다 — 리모트 MCP 서버를 계정 단위로 등록하면, 모든 Claude 클라이언트에서 동일하게 사용할 수 있다. 기기별 설정이 아니다.

이 글은 그 MCP 서버를 직접 호스팅하고, Cloudflare 뒤에 붙이고, OAuth 인증을 넣고, Claude Code CLI까지 연결한 전체 과정을 정리한다.

## 먼저 열어둘 개념들

### MCP (Model Context Protocol)

Anthropic이 제안한 프로토콜로, LLM 클라이언트가 외부 도구·데이터 소스에 접근하는 표준 인터페이스다. 로컬(stdio)과 리모트(HTTP/SSE) 두 가지 전송 방식이 있으며, Claude 커스텀 커넥터는 리모트 방식을 사용한다.

### OAuth 2.0 + PKCE

권한 부여 코드 흐름(Authorization Code Flow)에 PKCE(Proof Key for Code Exchange)를 결합한 인증 방식. 클라이언트가 `code_challenge`를 생성해 `/authorize`에 보내고, 토큰 교환 시 `code_verifier`로 증명한다. 공개 클라이언트(서버에 비밀을 저장할 수 없는 클라이언트)에서 `client_secret` 대신 사용한다.

### Cloudflare Tunnel + NPM

Cloudflare Tunnel이 트래픽을 로컬 네트워크로 가져오고, NPM(Nginx Proxy Manager)이 도메인별로 컨테이너 포트로 분배한다. 이 구성에서 Cloudflare는 엣지에서 응답을 수정할 수 있고, NPM은 헤더를 가공할 수 있다 — 둘 다 OAuth 플로우에 방해가 될 수 있다.

### Hermes (ROLEX)

내 홈랩에서 돌아가는 개인 AI 에이전트 런타임. Discord/Telegram/Webhook/Cron 입력을 받아 SSH, 터미널, 파일 시스템, GitHub, Obsidian 볼트 등에 직접 접근하는 도구를 호출한다. 로컬 ARM 서버에서 24시간 구동한다. Claude와는 다른 축의 에이전틱 AI — 이 글 마지막에서 비교한다.

## 아키텍처

```
Claude (Anthropic 클라우드, 미국)
  ↓ HTTPS
Cloudflare Edge (WAF / Bot Management / JS Challenge)
  ↓ Cloudflare Tunnel
NPM (n4000, Nginx Proxy Manager)
  ↓ proxy_pass
obsidian-mcp 컨테이너 (n4000, :8420)
  ↓ 파일시스템
Obsidian Vault (Syncthing 복제본)
```

| 컴포넌트 | 위치 | 역할 |
|---|---|---|
| Cloudflare Edge | 글로벌 | DNS, TLS 종료, WAF, Bot Management |
| Cloudflare Tunnel | n4000 → CF | 로컬 서비스를 공개 엔드포인트로 노출 |
| NPM | n4000 | 도메인 → 컨테이너 포트 라우팅, SSE 버퍼링 제어 |
| obsidian-mcp | n4000 :8420 | OAuth 2.0 + PKCE 내장 MCP 서버 |

## 1단계: MCP 서버 선택과 배포

### 패키지 선택

[`jimprosser/obsidian-web-mcp`](https://github.com/jimprosser/obsidian-web-mcp)를 선택했다. 이유:

- **파일시스템 직접 접근** — Obsidian.app이 켜져 있을 필요 없음. 경쟁 후보 `cyanheads/obsidian-mcp-server`는 Obsidian Local REST API 플러그인 의존 → 앱 상시 실행 필요
- **OAuth 2.0 + PKCE 내장** — Claude가 자동으로 discovery (`/.well-known/oauth-authorization-server`) 수행
- **Python 3.12, FastAPI 기반** — 홈랩 스택과 일관성

### Docker 배포

```dockerfile
# Dockerfile
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
WORKDIR /app
COPY repo/ .\nRUN uv sync --frozen || uv sync
EXPOSE 8420
CMD ["uv", "run", "vault-mcp"]
```

```yaml
# docker-compose.yml (최종)
services:
  obsidian-mcp:
    build: .
    container_name: obsidian-mcp
    env_file:
      - .env
    environment:
      - VAULT_PATH=/vault
      - VAULT_MCP_HOST=0.0.0.0
      - VAULT_MCP_PORT=8420
      - VAULT_MCP_PUBLIC_URL=https://obsidian-mcp.yeoun.org
      - VAULT_MCP_PATH=/mcp
      - VAULT_MCP_ALLOWED_HOSTS=obsidian-mcp.yeoun.org
    volumes:
      - /mnt/usb/yeoun_Desktop/Obsidian:/vault
    ports:
      - "127.0.0.1:8420:8420"
    restart: always
    networks:
      - default
      - nginx-proxy-manager_default
```

`.env` 파일에는 `VAULT_MCP_TOKEN`, `VAULT_OAUTH_USERNAME`, `VAULT_OAUTH_PASSWORD`를 설정한다 (`chmod 600`).

### 의존성 함정: `mcp==2.0.0` breaking change

배포 첫 시도에서 런타임 에러:

```
ModuleNotFoundError: No module named 'mcp.server.fastmcp'
```

원인: `pyproject.toml`의 `mcp[cli]>=1.9.0`에 상한이 없어서, `uv sync`가 방금 나온 `mcp==2.0.0`을 잡음. 이 버전은 `fastmcp` 모듈 구조를 갈아엎어서 코드가 기대하는 `from mcp.server.fastmcp import FastMCP`가 깨짐.

해결: 로컬 배포본에서 상한 추가.

```toml
# 수정 전
"mcp[cli]>=1.9.0"
# 수정 후
"mcp[cli]>=1.9.0,<2.0.0"
```

전형적인 "unpinned dependency + upstream breaking change" 사고. self-hosting에서는 의존성 상한을 직접 관리해야 한다.

## 2단계: Cloudflare Tunnel + NPM 라우팅

기존 홈랩 패턴을 그대로 따른다:

1. Cloudflare DNS에서 `obsidian-mcp.yeoun.org` CNAME → Tunnel ID `.cfargotunnel.com` (proxied: true)
2. n4000 NPM에 프록시 호스트 추가: `obsidian-mcp.yeoun.org` → `http://127.0.0.1:8420`
3. NPM 54.conf에 SSE 설정 추가 (이건 뒤에서 설명)

## 3단계: OAuth 인증 — Claude.ai 웹 커넥터

이제부터가 진짜다. Claude가 커넥터로 서버를 등록할 때, 백그라운드에서 OAuth 2.0 + PKCE 플로우를 수행한다. 이 플로우가 끝까지 도달해야 "Connected"가 뜬다. 중간에 하나라도 막히면 "서버에 연결할 수 없습니다"만 보게 된다.

### 문제 1: WWW-Authenticate 헤더 소거

**증상**: 커넥터 등록 시 "서버에 연결할 수 없습니다"만 반환. OAuth 플로우가 시작되지 않음.

**원인**: Claude의 OAuth 클라이언트는 먼저 `POST /`로 MCP initialize 요청을 보낸다. 서버가 401을 반환할 때 `WWW-Authenticate: Bearer resource_metadata=...` 헤더가 있어야 Claude가 OAuth discovery 엔드포인트를 찾을 수 있다. 그런데 **NPM의 기본 nginx 프록시 설정이 `WWW-Authenticate` 헤더를 전달하지 않는다.**

**확인**:

```bash
# 로컬 SNI (NPM 직접) — 헤더 있음
curl -sS -k --resolve obsidian-mcp.yeoun.org:443:127.0.0.1 -D- -o /dev/null \
  -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  https://obsidian-mcp.yeoun.org/
# → 401, www-authenticate: Bearer realm="mcp", resource_metadata="..."

# Cloudflare 엣지 — 헤더 없음
# → 401, (www-authenticate 헤더 없음)
```

**해결**: NPM 프록시 호스트 설정에 명시적 헤더 전달 추가:

```nginx
proxy_pass_header WWW-Authenticate;
```

### 문제 2: /authorize 경로 인증 차단

**증상**: OAuth discovery는 성공하지만, `/authorize` GET 요청에 401 반환.

**원인**: 인증 미들웨어가 `/authorize`를 보호된 경로로 취급. OAuth 플로우의 시작점은 인증 예외여야 한다.

**해결**: exempt path 목록에 OAuth 엔드포인트 추가:

```python
_AUTH_EXEMPT_PATHS = {
    "/authorize", "/login", "/oauth/login",
    "/token", "/register",
    "/.well-known/oauth-authorization-server",
    "/.well-known/oauth-protected-resource",
    "/favicon.ico",
}
```

### 문제 3: /authorize 응답 형식 — 200 HTML vs 302 Redirect

**증상**: `/authorize`가 200 HTML 로그인 폼을 반환하는데, Claude가 브라우저를 열지 않음.

**원인**: Claude의 OAuth 클라이언트는 `/authorize`에서 **200 HTML consent page**를 기대한다. OAuth 표준(302 redirect)과 다르다.

**해결**: `/authorize` GET 요청 시 200 HTML 로그인 폼을 직접 반환:

```python
async def oauth_authorize(request: Request):
    if request.method == "GET":
        return _login_form(oauth_params)
    # POST: username/password 검증 후 302 redirect to callback
```

### 문제 4: Cloudflare JavaScript Challenge 주입

**증상**: `/authorize` 200 HTML 응답이 Claude에 도달하지만 페이지가 렌더링되지 않음. 응답 크기가 로컬(1835 bytes)과 엣지(2773 bytes)에서 다름.

**원인**: Cloudflare의 **Bot Management** WAF 규칙이 비한국 IP(Anthropic 클라우드 = 미국)에서 오는 요청에 `managed_challenge`를 적용. 응답에 JavaScript challenge 스크립트를 주입:

```html
<script>(function(){...a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js'...})</script>
```

**확인**:

```bash
# 로컬 — challenge-platform 없음 (1835 bytes)
ssh n4000 'curl -sS -k --resolve obsidian-mcp.yeoun.org:443:127.0.0.1 \
  "https://obsidian-mcp.yeoun.org/authorize?..." | grep -c challenge-platform'
# → 0

# Cloudflare 엣지 — challenge-platform 있음 (2773 bytes)
curl -sS "https://obsidian-mcp.yeoun.org/authorize?..." | grep -c challenge-platform
# → 1
```

**해결**: 두 단계.

**1단계: WAF skip rule**

Cloudflare WAF Custom Ruleset에 obsidian-mcp 전용 skip 규칙을 기존 "Bot block countries abroad" 규칙보다 **앞에** 배치:

```json
{
  "expression": "(http.host eq \"obsidian-mcp.yeoun.org\")",
  "action": "skip",
  "action_parameters": { "ruleset": "current" }
}
```

**2단계: `Cache-Control: no-transform` 헤더**

WAF skip만으로는 Cloudflare의 JavaScript Detections 기능이 계속 스크립트를 주입. 서버 응답에 헤더 추가:

```python
resp.headers["Cache-Control"] = "no-store, no-transform"
```

`no-transform`은 RFC 7234에 정의된 대로 중개자(프록시/CDN)가 응답 본문을 변형하는 것을 금지한다. Cloudflare도 이 헤더를 존중.

결과: 엣지 응답 크기 = 로컬 응답 크기 = 1835 bytes. challenge-platform 주입 사라짐.

### 문제 5: 토큰 응답 형식

**증상**: OAuth 플로우가 끝까지 실행됨 (`POST /oauth/token` → 200 OK). 서버 로그에 "OAuth token issued"가 찍히는데, Claude는 여전히 "인증에 실패했습니다"를 반환. 토큰 발급 후 MCP 요청(`POST /`)을 보내지 않음. 동일한 OAuth 플로우가 3번 반복됨.

**원인**: 토큰 응답에 두 가지 문제:

1. **`token_type: "bearer"` (소문자)** — RFC 6749는 `Bearer` (대문자 B)를 요구. Claude가 대소문자를 엄격하게 검사.
2. **`refresh_token` 누락** — DCR에서 `grant_types: ["authorization_code", "refresh_token"]`을 광고했으니, Claude는 토큰 응답에 `refresh_token`이 있을 것으로 기대.

**해결**:

```python
return JSONResponse({
    "access_token": config.VAULT_MCP_TOKEN,
    "token_type": "Bearer",         # 대문자 B
    "expires_in": 86400,
    "refresh_token": config.VAULT_MCP_TOKEN,
    "scope": "mcp offline_access",
})
```

## 4단계: /mcp 서브경로 분리 — Claude Code CLI

claude.ai 웹 커넥터는 위 5개 문제를 해결하면 연결된다. 하지만 **Claude Code CLI**는 다른 문제가 있었다.

### 증상

Claude Code CLI에서 `claude mcp add`로 서버를 등록하면 `✔ Connected`가 뜨지만, 실제 도구 호출 시 "needs authorization" 에러. OAuth discovery 엔드포인트(`/.well-known/oauth-authorization-server`)가 존재하면, CLI가 헤더 인증을 무시하고 OAuth 플로우를 시도한다. headless 서버에서는 브라우저를 열 수 없으니 실패.

### 원인

Claude Code CLI의 동작 순서:

1. `GET /.well-known/oauth-authorization-server` 확인
2. OAuth discovery가 있으면 → OAuth 플로우 시도 (브라우저 필요)
3. OAuth discovery가 없으면 → 헤더 인증 사용

서버 루트(`/`)에 OAuth discovery를 유지하면서, CLI용으로는 별도 경로가 필요했다.

### 해결: `/mcp` 서브경로 분리

서버를 두 가지 경로로 운영:

| 경로 | 인증 방식 | 용도 | WWW-Authenticate |
|---|---|---|---|
| `/` | OAuth 2.0 + PKCE | claude.ai 웹 커넥터 | 있음 |
| `/mcp` | Bearer 토큰 (헤더) | Claude Code CLI | 없음 |

**서버 측 변경**:

`VAULT_MCP_PATH=/mcp` 환경 변수로 MCP 엔드포인트를 `/mcp`로 이동. 인증 미들웨어에서 `/mcp` 경로의 401 응답에는 `WWW-Authenticate` 헤더를 보내지 않는다:

```python
mcp_path = config.VAULT_MCP_PATH  # "/mcp"
is_mcp_endpoint = mcp_path != "/" and request.url.path.startswith(mcp_path)
headers = {} if is_mcp_endpoint else {"WWW-Authenticate": _www_authenticate(request, "invalid_request")}
return JSONResponse(
    {"error": "Missing or malformed Authorization header"},
    status_code=401,
    headers=headers,
)
```

`WWW-Authenticate`가 없는 401은 Claude Code CLI에게 "OAuth 안 함, 헤더 인증만"이라는 신호.

**CLI 등록**:

```bash
claude mcp add obsidian-vault \
  --transport http https://obsidian-mcp.yeoun.org/mcp \
  --header "Authorization: Bearer [REDACTED]" \
  -s local
```

```bash
$ claude mcp list
obsidian-vault: https://obsidian-mcp.yeoun.org/mcp (HTTP) - ✔ Connected
```

### SSE 버퍼링: NPM 추가 설정

SSE (Server-Sent Events) 스트림이 NPM 기본 설정에서 버퍼링되어 Claude가 응답을 못 받는 문제도 있었다. NPM 54.conf에 추가:

```nginx
location / {
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $http_connection;
    proxy_http_version 1.1;
    include conf.d/include/proxy.conf;

    # SSE streaming — critical for MCP
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    chunked_transfer_encoding on;
}
```

`proxy_buffering off`로 nginx가 SSE 응답을 실시간으로 전달. `proxy_read_timeout 86400s`(24시간)로 긴 연결 유지.


![Claude 모바일 앱에서 Obsidian MCP 연결 성공 화면](/images/claude-mcp-connected.jpg)

_Claude 모바일 앱에서 Obsidian 볼트 MCP 연결 성공. 카테고리 목록이 정상적으로 표시되고 있다._

## Hermes vs Claude: 에이전틱 AI로서 두 역할

이 과정을 하면서, 같은 "Obsidian 볼트에 접근하는 AI"라도 **Hermes와 Claude의 역할이 근본적으로 다르다**는 걸 체감했다. 두 축은 모델 선택의 근거가 다르고, 인증 방식이 다르고, 강점이 다르다.

### Hermes (ROLEX): 실행형 에이전트 — 백엔드는 GLM-5.2

Hermes는 내 홈랩 ARM 서버에서 24시간 구동하는 개인 AI 에이전트 런타임이다. 백엔드 모델은 Ollama Cloud Pro의 **GLM-5.2** (지능지수 51, GDPval-AA v2 1524 — 오픈웨이트 1위). 월 $20 정액제, 주간 한도 내 무제한 호출.

- **직접 접근**: SSH, 터미널, 파일 시스템을 도구로 호출. 볼트 파일을 `read_file`로 읽고 `patch`로 편집. MCP도 필요 없다 — 이미 서버 안에 있으니까
- **플랫폼 독립**: Telegram, Discord, Webhook, Cron 어디서든 입력 받음. 특정 클라이언트 앱에 종속 안 됨
- **상시 구동**: 대화 없이도 cron job으로 자동 실행. "매일 9시 브리핑", "서버 죽으면 알림" 같은 작업을 스스로 함
- **인증 불필요**: 볼트는 로컬 파일 시스템. OAuth 2.0이고 뭐고 없다

왜 GLM-5.2인가? 이건 별도 결정 과정을 거쳤다 ([Hermes 백엔드 결정](#관련) 참조). 핵심 근거:

1. **지능은 동급이었다.** AA Intelligence Index에서 GLM-5.2(max) = 51 = GPT-5.6 Luna(max). Luna로 바꿔도 손해가 없고, Terra(55)로 가야 4점 이득인데, ChatGPT Plus 구독에서 Terra를 안정적으로 쓸 수 있는지 불확실
2. **환각 저항이 역설적이었다.** AA-Omniscience Index에서 GLM-5.2는 4.0(29위). GPT-5.6 Luna는 **-11.2**(60위), Terra는 **-0.2**(40위) — **Luna/Terra는 GLM보다 환각이 더 심하다.** ChatGPT Plus에서 Sol(21.7)만 개선되지만, Plus에서 Sol 한도는 15~90 메시지/5시간이라 Hermes 일 115회 호출을 커버 못 함
3. **컨텍스트가 4배 넓다.** GLM-5.2: 1M vs Codex OAuth: 272K. 홈랩 디버깅 세션에서 컨텍스트가 길어지는 게 체감된다
4. **비용은 같다.** 둘 다 $20/월. 근데 Ollama Cloud Pro는 주간 한도 내 무제한(정액제), ChatGPT Plus는 5시간당 메시지 캡 + 주간 토큰 캡

결론: **Ollama Pro(GLM-5.2) 유지가 합리적** — 지능 동급, 환각 저항이 더 나음(놀랍게도), 컨텍스트 4배, 비용 동일. 코딩 에이전트(Codex 1위) 우위가 매력적이지만 Hermes 코딩 토픽 비중은 5%뿐이라 과소비.

GLM-5.2의 유일한 실질 약점은 환각 저항(AA-Omniscience 4). 이건 Claude Pro(Sonnet 5: 15.3, Opus 4.8)로 보완한다 — 같은 토큰을 두 번 검증하는 방식.

> 단, 이건 "Ollama Pro가 계속 $20에 제공된다"는 전제. Ollama 정책 변경 시 재판단.

### Claude (MCP 커넥터): 사고 파트너 — 백엔드는 Sonnet 5 / Opus 4.8

Claude는 이 글의 주제처럼 MCP 커넥터로 볼트에 접근한다. 백엔드는 **Claude Pro** ($20/월) — Sonnet 5(환각 저항 15.3)가 기본, Opus 4.8(지능지수 56)이 고부하 작업용.

- **표준 프로토콜**: MCP를 통해 볼트에 접근. OAuth 2.0 + PKCE 인증 필요 — 이 글에서 해결한 모든 과정
- **클라이언트 종속**: claude.ai 웹·데스크톱·모바일 앱 안에서 작동. 커넥터 하나 등록하면 모든 기기에서 동일하게 사용
- **대화 기반**: 사용자가 대화를 시작할 때만 동작. cron이나 webhook 자동 실행 불가
- **읽기 중심**: 볼트를 컨텍스트로 읽어서 대화에 활용. 쓰기 도구도 있지만 구조상 읽기가 주

왜 Claude Pro인가? 근거:

1. **환각 저항이 결정적 차이.** Sonnet 5의 AA-Omniscience 15.3 vs GLM-5.2의 4.0 — 3.8배. 모르는 문제에서 지어내는 비율이 37.3% vs "높음". 연구·인용 작업에서 이 차이는 치명적
2. **지능 상위 모델 접근.** Opus 4.8(지수 56)은 GLM-5.2(51)보다 5점 높음. 연구 전략·논문 구조 설계 등 고부하 작업에서 차이 발생
3. **학교 Helpy(무료)로는 대체 불가.** Helpy에 Opus 4.7이 있지만 툴 전무(웹검색·코드실행 불가, 실측 확인). "툴 없는 Opus"는 "손 없는 뇌" — Claude Code의 대체재가 아니다
4. **ChatGPT Plus는 기각.** Luna/Terra 환각이 GLM보다 나쁘고, Sol 한도로 커버 안 됨 (위와 동일 근거)

이래서 최종 스택은 **Ollama Pro $20 + Claude Pro $20 = $40/월**. ChatGPT Plus 없음.

### 두 역할을 한 표로

| | Hermes (ROLEX) | Claude (MCP 커넥터) |
|---|---|---|
| **백엔드 모델** | GLM-5.2 (Ollama Cloud Pro, $20/월) | Sonnet 5 / Opus 4.8 (Claude Pro, $20/월) |
| **역할** | 실행형 에이전트 ("손") | 사고 파트너 ("눈과 입") |
| **접근 방식** | 파일 시스템 직접 (SSH, read_file, patch) | MCP 프로토콜 (OAuth 2.0 + PKCE) |
| **실행 트리거** | Telegram/Discord/Cron/Webhook | 사용자가 Claude 앱에서 대화 시작 |
| **강점** | 인프라 제어, 자동화, 백그라운드 작업 | 자연어 추론, 대화, 환각 저항, 창작 |
| **약점** | 환각 저항 낮음 (AA-Omni 4) | 자동화 불가, 볼트 쓰기는 MCP 도구 필요 |
| **볼트 역할** | 운영 대상 (읽기/쓰기/편집/백업) | 컨텍스트 소스 (주로 읽기) |
| **컨텍스트** | 1M (GLM-5.2) | ~200K (Claude) |
| **월 비용** | $20 (무제한, 주간 한도) | $20 (사용량 기반) |

### 왜 둘 다 필요한가

Hermes는 "볼트의 파일을 백업하고, 노트를 정리하고, 서버를 고치고" 같은 **실행 작업**에 강하다. Claude는 "이 노트와 저 노트를 연결해보면 어떤 인사이트가 나오는가?" 같은 **추론·대화 작업**에 강하다.

**차이를 만드는 건 모델 IQ가 아니라 컨텍스트 접근권이었다.** ROLEX가 볼트·스킬·과거세션·Linear를 읽고 "사수 상황·저자 목표·loss 4종"을 아는 상태로 연구 전략을 짜는 것 — 지능지수 57짜리 Gemini도 이건 못 한다. 하지만 그 전략의 최종 검증은 환각 저항 15.3인 Sonnet 5가 담당한다.

MCP 커넥터는 Claude에게 볼트라는 컨텍스트를 주지만, Claude가 서버를 운영하거나 cron job을 돌릴 수는 없다. 반대로 Hermes는 서버를 운영할 수 있지만, Claude 수준의 대화 품질·환각 저항은 백엔드(GLM-5.2)의 한계에 걸린다.

두 축이 합쳐지면: **Hermes가 인프라를 유지하고 자동화를 돌리면서, Claude로 볼트 내용을 가지고 깊이 있는 대화를 한다.** 이 글의 MCP 서버 배포가 그 연결고리를 만든 작업이다.

## 정리

### 전체 과정 요약

| 단계 | 작업 | 핵심 |
|---|---|---|
| 1 | MCP 서버 배포 | `jimprosser/obsidian-web-mcp`, Docker, `mcp<2.0.0` 상한 |
| 2 | Cloudflare Tunnel + NPM | 표준 홈랩 패턴, SSE 버퍼링 off |
| 3 | OAuth 인증 (웹) | WWW-Authenticate 전달, exempt path, 200 HTML, WAF skip, 토큰 형식 |
| 4 | /mcp 서브경로 분리 | CLI용 Bearer 헤더, 웹용 OAuth — 한 서버에서 두 경로 |
| 5 | Hermes vs Claude | 실행형 에이전트 vs 대화형 컨텍스트 파트너 |

### 교훈

1. **OAuth 플로우는 끝까지 도달해야 한다.** 중간에 하나라도 막히면 처음부터 다시. 각 단계의 응답을 로컬과 엣지에서 각각 확인하는 습관이 필요.

2. **CDN은 응답을 수정한다.** Cloudflare는 "보안" 기능의 부산물로 HTML 응답에 스크립트를 주입. `Cache-Control: no-transform`으로 차단. OAuth consent page처럼 클라이언트가 엄격하게 파싱하는 응답에서는 필수.

3. **대소문자가 중요하다.** RFC 6749는 `token_type: "Bearer"`를 요구. `bearer`는 기준에 맞지 않고, Claude처럼 엄격한 클라이언트는 거부.

4. **광고한 건 지켜야 한다.** DCR에서 `refresh_token` grant type을 광고했으면 토큰 응답에 `refresh_token`을 포함.

5. **클라이언트마다 인증 경로가 다를 수 있다.** 웹은 OAuth discovery가 있으면 OAuth를 시도하고, CLI도 마찬가준데 headless에서는 브라우저를 열 수 없다. 서브경로 분리로 한 서버에서 두 인증 방식을 동시 지원.

6. **로컬과 엣지를 비교하라.** 응답 크기 비교만으로 CDN의 응답 수정 여부를 확인할 수 있다. 1835 vs 2773 bytes 차이가 핵심 단서.

## 환경

- 서버: n4000 (Intel N4000, Ubuntu 22.04, Docker)
- MCP 서버: `jimprosser/obsidian-web-mcp` v0.2.0 (Python 3.12, FastAPI)
- 역방향 프록시: NPM (Nginx Proxy Manager)
- CDN: Cloudflare (Free 플랜, Cloudflare Tunnel)
- 클라이언트: claude.ai 커스텀 커넥터 + Claude Code CLI 2.1.220
- 볼트 동기화: Syncthing (arm 원본 → n4000 복제본)

## 관련

- **Hermes 백엔드 결정 - Ollama Pro vs ChatGPT Plus (2026-08-01)** — GLM-5.2 vs GPT-5.6 벤치마크·환각 저항·비용 비교. 이 글의 "왜 GLM-5.2인가" 근거의 1차 출처
- **AI 도구 배치 전략 (2026-07)** — 최종 스택($40/월) 결정·GLM vs Sonnet 5 면밀 비교·환각 저항 3.8배 차이
- **Claude 플랫폼 통합 - Obsidian MCP 배포 핸드오프 (2026-08-01)** — 배포 과정 핸드오프 문서
- **홈랩 운영 퀵레퍼런스 (LLM용)**
- [Anthropic - Authentication for connectors](https://claude.com/docs/connectors/building/authentication)
- [jimprosser/obsidian-web-mcp](https://github.com/jimprosser/obsidian-web-mcp)
- [Artificial Analysis - GPT-5.6](https://artificialanalysis.ai/articles/gpt-5-6-has-landed) — AA Intelligence Index / Omniscience Index 출처
- [BenchLM AA-Omniscience Leaderboard](https://benchlm.ai/benchmarks/aaomniscienceindex) — 환각 저항 지수 출처

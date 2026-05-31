---
title: 'Hermes Agent 기반 홈서버 자동진단·복구 파이프라인 만들기'
description: '장애 알림은 “서버가 죽었다”에서 끝나면 반쪽짜리다. 내가 원한 건 알림을 받은 뒤, 에이전트가 직접 노드에 들어가 컨테이너 상태와 로그를 보고, 가능한 경우 복구까지 수행하는 파이프라인이었다. 이 글은 내 홈서버에서 구성한 Uptime Kuma → Hermes Agent → SSH/Docker 진단 → Discord 보고/복구 로그 저장 파이프라인을 정리한 기록이다. 단순 알림 봇이 아니라'
published: 2026-05-31T02:23:57.000Z
draft: false
lang: ko
category: "DevOps / Observability"
tags: ["Homelab", "Uptime Kuma", "Hermes Agent", "Auto Recovery", "Docker", "Observability", "Webhook", "SSH", "Discord", "Obsidian", "Prometheus", "Grafana", "Nginx Proxy Manager", "Cloudflared"]
---

<p></p><blockquote>장애 알림은 “서버가 죽었다”에서 끝나면 반쪽짜리다.<br>내가 원한 건 알림을 받은 뒤, 에이전트가 직접 노드에 들어가 컨테이너 상태와 로그를 보고, 가능한 경우 복구까지 수행하는 파이프라인이었다.</blockquote><p>이 글은 내 홈서버에서 구성한 <strong>Uptime Kuma → Hermes Agent → SSH/Docker 진단 → Discord 보고/복구 로그 저장</strong> 파이프라인을 정리한 기록이다. 단순 알림 봇이 아니라, 장애가 발생하면 LLM 에이전트가 실제 운영 도구를 사용해 원인 분리까지 수행하도록 구성했다.</p><p>먼저 용어부터 짚고 간다.</p><ul><li><strong>Uptime Kuma</strong>는 오픈소스 self-hosted 모니터링 도구다. HTTP, TCP, Ping, DNS 같은 체크를 주기적으로 수행하고, 장애가 나면 Discord/Slack/Webhook 등으로 알림을 보낼 수 있다. 쉽게 말하면 홈서버용 “서비스 생존 확인기”다.</li><li><strong>Hermes Agent</strong>는 내가 쓰는 개인 AI 에이전트 런타임이다. Discord DM, Webhook, cron 같은 입력을 받아 실제 도구(SSH, 터미널, 파일, GitHub, Obsidian 등)를 호출할 수 있다. 구조상으로는 <strong>OpenClaw 같은 개인 운영 에이전트</strong>에 가깝다. 단순 챗봇이 아니라, 정해진 권한 안에서 서버를 읽고 진단하고 기록하는 실행 환경이다.</li><li>이 글의 핵심은 둘을 붙여서 <strong>“모니터링 알림 → AI 에이전트 실행 → 서버 진단/안전한 복구 → 사람에게 보고”</strong> 흐름을 만든 것이다.</li></ul><h2 id="%EA%B5%AC%EC%84%B1-%EC%9A%94%EC%95%BD">구성 요약</h2><p>전체 흐름은 아래와 같다.</p><pre><code class="language-text">Uptime Kuma
  └─ Webhook Notification
      └─ Hermes Gateway Webhook (:8644)
          └─ Hermes Agent Run
              ├─ Uptime Kuma payload 파싱
              ├─ 서비스/도메인 → 노드 매핑
              ├─ SSH로 n4000/n4200/ARM 노드 진단
              ├─ docker ps/logs/events, curl, DNS 확인
              ├─ 안전한 경우 컨테이너 재시작
              ├─ Discord DM 보고
              └─ Obsidian 서버 복구로그 저장
</code></pre><p>현재 구성 기준 핵심 컴포넌트는 다음과 같다.</p>
<!--kg-card-begin: html-->
<table>
  <thead>
    <tr><th>영역</th><th>구성</th><th>역할</th></tr>
  </thead>
  <tbody>
    <tr><td>모니터링</td><td>Uptime Kuma 컨테이너</td><td>서비스 상태 체크와 DOWN/UP 이벤트 생성</td></tr>
    <tr><td>이벤트 트리거</td><td>Uptime Kuma Webhook Notification</td><td>장애 이벤트를 Hermes webhook으로 전달</td></tr>
    <tr><td>에이전트 런타임</td><td>Hermes Agent Gateway</td><td>Webhook을 받아 에이전트 실행 생성</td></tr>
    <tr><td>웹훅 리스너</td><td><code>172.24.0.1:8644</code>, route <code>uptime-kuma</code></td><td>Kuma 컨테이너가 접근 가능한 내부 endpoint</td></tr>
    <tr><td>진단 도구</td><td>terminal / file / skills / session_search</td><td>로그, 컨테이너, DNS, 이전 사건 기록 확인</td></tr>
    <tr><td>원격 진단</td><td>SSH alias <code>n4000</code>, <code>n4200</code></td><td>서비스가 실제로 떠 있는 노드에 접속</td></tr>
    <tr><td>보고 채널</td><td>Discord DM</td><td>장애/영향/조치/현재상태를 짧게 보고</td></tr>
    <tr><td>장기 기록</td><td>Obsidian <code>서버 복구로그/</code></td><td>재발 분석용 incident log 저장</td></tr>
  </tbody>
</table>
<!--kg-card-end: html-->
<h2 id="%EC%99%9C-%EA%B7%B8%EB%83%A5-discord-%EC%95%8C%EB%A6%BC%EB%A7%8C%EC%9C%BC%EB%A1%9C-%EB%B6%80%EC%A1%B1%ED%96%88%EB%82%98">왜 그냥 Discord 알림만으로 부족했나</h2><p>일반적인 Uptime Kuma 알림은 다음 정도에서 멈춘다.</p><pre><code class="language-text">Service DOWN: https://example.com
Reason: 502 Bad Gateway
</code></pre><p>하지만 운영자가 실제로 알고 싶은 건 이것이다.</p><ul><li>앱 컨테이너가 죽었나?</li><li>프록시가 죽었나?</li><li>DNS가 깨졌나?</li><li>DB가 죽었나?</li><li>방금 누가 재시작했나?</li><li>지금 복구됐나?</li><li>다음에 재발하지 않으려면 뭘 바꿔야 하나?</li></ul><p>그래서 알림을 <strong>최종 메시지</strong>가 아니라 <strong>에이전트 실행 트리거</strong>로 바꿨다.</p><h2 id="hermes-webhook-%EC%84%A4%EC%A0%95">Hermes Webhook 설정</h2><p>Hermes Gateway의 webhook 플랫폼을 활성화하고, Uptime Kuma 컨테이너가 접근 가능한 Docker bridge gateway IP에 바인딩했다.</p><pre><code class="language-yaml">platforms:
  webhook:
    enabled: true
    extra:
      host: "172.24.0.1"
      port: 8644
      secret: "&lt;redacted&gt;"
</code></pre><p>중요한 포인트는 <code>127.0.0.1</code>이 아니라 <strong>Uptime Kuma 컨테이너가 보는 bridge gateway IP</strong>에 붙였다는 점이다. 같은 호스트라도 컨테이너 입장에서는 <code>localhost</code>가 자기 자신이기 때문에, Hermes가 host loopback에만 떠 있으면 Kuma에서 접근할 수 없다.</p><p>현재 webhook listener는 다음 형태로 떠 있다.</p><pre><code class="language-text">LISTEN 172.24.0.1:8644
route: uptime-kuma
</code></pre><h2 id="uptime-kuma-notification-%EC%84%A4%EC%A0%95">Uptime Kuma Notification 설정</h2><p>Uptime Kuma에는 <code>Hermes Auto-Diagnosis</code>라는 webhook notification을 추가했다.</p><p>핵심 설정은 다음과 같다.</p><pre><code class="language-json">{
  "name": "Hermes Auto-Diagnosis",
  "type": "webhook",
  "webhookURL": "http://172.24.0.1:8644/webhooks/uptime-kuma",
  "webhookContentType": "json",
  "webhookAdditionalHeaders": "{\"X-Gitlab-Token\":\"&lt;redacted&gt;\"}"
}
</code></pre><p>Hermes webhook subscription 쪽에서는 같은 secret을 검증한다. Uptime Kuma의 webhook provider는 GitLab 스타일 헤더인 <code>X-Gitlab-Token</code>을 넣을 수 있어서, 이걸 인증 헤더로 사용했다.</p><p>현재 Hermes Auto-Diagnosis에 연결된 주요 모니터는 다음과 같다.</p>
<!--kg-card-begin: html-->
<table>
  <thead>
    <tr><th>모니터</th><th>URL</th><th>주요 진단 대상</th></tr>
  </thead>
  <tbody>
    <tr><td>nextcloud</td><td><code>https://nextcloud.yeoun.org</code></td><td>Nextcloud, Redis, MariaDB, NPM, Cloudflared</td></tr>
    <tr><td>immich</td><td><code>https://immich.yeoun.org</code></td><td>Immich app, database, NPM, Cloudflared</td></tr>
    <tr><td>syncthing</td><td><code>https://syncthing.yeoun.org</code></td><td>Syncthing, NPM, Cloudflared</td></tr>
    <tr><td>authentik</td><td><code>https://auth.yeoun.org</code></td><td>Authentik, PostgreSQL, Redis</td></tr>
    <tr><td>yeoun.org</td><td><code>https://yeoun.org</code></td><td>Ghost, NPM, Cloudflared</td></tr>
    <tr><td>adguard</td><td><code>https://adguard.yeoun.org</code></td><td>AdGuard Home, 내부 DNS</td></tr>
    <tr><td>npm</td><td><code>https://npm.yeoun.org</code></td><td>Nginx Proxy Manager, split DNS</td></tr>
    <tr><td>homepage</td><td><code>https://home.yeoun.org</code></td><td>Homepage, NPM, Cloudflared</td></tr>
    <tr><td>vaultwarden</td><td><code>https://vault.yeoun.org</code></td><td>Vaultwarden, NPM, Cloudflared</td></tr>
    <tr><td>grafana</td><td><code>https://grafana.yeoun.org</code></td><td>Grafana, Prometheus endpoint</td></tr>
    <tr><td>navidrome</td><td><code>https://music.yeoun.org</code></td><td>Navidrome, media volume, NPM</td></tr>
    <tr><td>chatbot</td><td><code>https://chatbot.yeoun.org</code></td><td>Chatbot service, proxy path</td></tr>
  </tbody>
</table>
<!--kg-card-end: html-->
<p>대부분 60초 interval, 1회 retry로 동작한다.</p><h2 id="%EC%84%9C%EB%B9%84%EC%8A%A4-%EB%A7%B5-%EB%8F%84%EB%A9%94%EC%9D%B8%EC%9D%84-%EB%85%B8%EB%93%9C%EC%99%80-%EC%BB%A8%ED%85%8C%EC%9D%B4%EB%84%88%EB%A1%9C-%EB%A7%A4%ED%95%91%ED%95%98%EA%B8%B0">서비스 맵: 도메인을 노드와 컨테이너로 매핑하기</h2><p>에이전트가 장애를 진단하려면 “이 도메인이 어느 노드의 어떤 컨테이너인지”를 알아야 한다. 그래서 <code>docker ps</code> 기반 서비스 맵을 Hermes skill reference로 저장했다.</p><p>현재 기준 노드 역할은 대략 이렇게 나뉜다.</p>
<!--kg-card-begin: html-->
<table>
  <thead>
    <tr><th>노드</th><th>역할</th><th>대표 서비스</th></tr>
  </thead>
  <tbody>
    <tr><td><code>oci-arm-node</code></td><td>에이전트/모니터링/공용 DB 계층</td><td>Hermes Gateway, Uptime Kuma, Grafana, Prometheus, DB 계열, Authentik</td></tr>
    <tr><td><code>n4000</code></td><td>프록시와 주요 self-hosted 앱 계층</td><td>Nginx Proxy Manager, Cloudflared, Nextcloud, Immich, Navidrome, Vaultwarden, AdGuard Home</td></tr>
    <tr><td><code>n4200</code></td><td>블로그/대시보드/홈 자동화 계층</td><td>Ghost(<code>yeoun.org</code>), Homepage, Quartz, Home Assistant, Vikunja</td></tr>
  </tbody>
</table>
<!--kg-card-end: html-->
<p>예를 들어 <code>yeoun.org</code> 장애가 오면 먼저 <code>n4200</code>의 <code>ghost-ghost-1</code>을 보고, Ghost가 정상이라면 <code>n4000</code>의 Nginx Proxy Manager와 Cloudflared를 확인한다.</p><pre><code class="language-text">yeoun.org / Ghost
  -&gt; n4200: ghost-ghost-1
  -&gt; n4000: nginx-proxy-manager, cloudflared
</code></pre><p><code>nextcloud.yeoun.org</code>라면 경로가 다르다.</p><pre><code class="language-text">nextcloud.yeoun.org
  -&gt; n4000: nextcloud, redis
  -&gt; n4000: nginx-proxy-manager, cloudflared
  -&gt; oci-arm-node: mariadb-main
</code></pre><p>이 매핑이 있어야 에이전트가 무작정 모든 서버를 훑지 않고, 장애 도메인에 맞춰 빠르게 좁혀갈 수 있다.</p><h2 id="hermes-agent-%ED%94%84%EB%A1%AC%ED%94%84%ED%8A%B8-%EC%84%A4%EA%B3%84">Hermes Agent 프롬프트 설계</h2><p>Uptime Kuma payload는 <code>msg</code>, <code>monitor</code>, <code>heartbeat</code> 구조로 들어온다. Hermes subscription prompt는 이 JSON을 파싱하고, 다음 규칙을 따른다.</p><ul><li>monitor name/url/status/message를 먼저 파싱한다.</li><li><code>{payload}</code> 같은 템플릿 문자열이 그대로 남아 있으면 무시하고 raw JSON을 본다.</li><li>DOWN이면 서비스 맵에 따라 노드를 선택한다.</li><li><code>docker ps</code>, <code>docker logs</code>, <code>docker events</code>, <code>curl</code>, DNS 조회를 수행한다.</li><li>명확히 실패한 단일 컨테이너는 재시작 가능하다.</li><li>DB 복구, 볼륨 삭제, 방화벽/인증 변경, 광범위한 compose down은 승인 없이 하지 않는다.</li><li>결과는 Discord에 짧게 보고하고, 복구 사건은 Obsidian에 남긴다.</li></ul><p>즉, 에이전트에게 “알아서 고쳐”가 아니라 <strong>운영 runbook의 경계</strong>를 준다.</p><h2 id="%EC%8B%A4%EC%A0%9C-%EA%B2%80%EC%A6%9D-1-ghost-%EC%9E%A5%EC%95%A0-%EC%9E%AC%ED%85%8C%EC%8A%A4%ED%8A%B8">실제 검증 1: Ghost 장애 재테스트</h2><p>Ghost 컨테이너를 의도적으로 중지해서 Uptime Kuma → Hermes 경로를 검증했다.</p><p>타임라인은 다음과 같다.</p><pre><code class="language-text">10:36:13  ghost-ghost-1 중지
10:36:20  https://yeoun.org HTTP/2 502 확인
10:36:22  Kuma heartbeat status=2, 502 pending
10:37:22  Kuma heartbeat status=0, DOWN 확정 / webhook 발사
10:37:33  ghost-ghost-1 재시작
10:38:22  Kuma heartbeat status=1, 200 OK
10:38:23  UP webhook 발사
10:38:28  외부 curl 기준 HTTP/2 200 복구 확인
</code></pre><p>검증 결과, DOWN/UP 이벤트 모두 Hermes agent run을 트리거했다.</p><pre><code class="language-text">DOWN webhook response: api_calls=5
UP webhook response:   api_calls=6
</code></pre><p>이 테스트는 의도된 장애였고, 서비스는 정상 복구됐다. 이 사건은 Obsidian의 <code>서버 복구로그/</code>에 별도 Markdown으로 남겼다.</p><h2 id="%EC%8B%A4%EC%A0%9C-%EA%B2%80%EC%A6%9D-2-npmyeounorg-split-dns-%EC%9E%A5%EC%95%A0">실제 검증 2: npm.yeoun.org split DNS 장애</h2><p>다른 실제 케이스도 있었다. <code>npm.yeoun.org</code>가 Uptime Kuma에서 DOWN으로 감지됐는데, 처음 보면 Nginx Proxy Manager 장애처럼 보인다.</p><p>하지만 Hermes가 확인한 결과는 달랐다.</p><ul><li><code>nginx-proxy-manager</code>: 재시작 흔적 없음</li><li><code>cloudflared</code>: 재시작 흔적 없음</li><li><code>adguardhome</code>: 10:43경 종료 후 약 55초 뒤 재시작</li><li><code>npm.yeoun.org</code>: 공용 Cloudflare DNS에서는 NXDOMAIN</li><li>내부 AdGuard에서는 <code>100.124.4.110</code>으로 해석</li></ul><p>즉, 이 도메인은 public DNS가 아니라 내부 split DNS에 의존하고 있었고, AdGuard Home 재시작 동안 Uptime Kuma가 이름 해석에 실패한 것이다.</p><p>장애 원인은 “프록시 다운”이 아니라 <strong>내부 DNS 계층의 순간 장애</strong>였다.</p><p>이게 에이전트 진단의 장점이다. 단순 알림이면 <code>502</code> 또는 <code>ENOTFOUND</code>만 보고 끝났겠지만, Hermes는 Docker event와 DNS 결과를 엮어서 원인을 좁혔다.</p><h2 id="%EC%9A%B4%EC%98%81%EC%83%81-%EC%96%BB%EC%9D%80-%EA%B5%90%ED%9B%88">운영상 얻은 교훈</h2><h3 id="1-%EC%95%8C%EB%A6%BC%EC%9D%80-%EC%9B%90%EC%9D%B8-%EB%B6%84%EC%84%9D%EC%9D%98-%EC%8B%9C%EC%9E%91%EC%A0%90%EC%9D%B4%EC%96%B4%EC%95%BC-%ED%95%9C%EB%8B%A4">1. 알림은 원인 분석의 시작점이어야 한다</h3><p>Uptime Kuma는 장애 감지에 강하다. 하지만 원인 분석은 별도의 맥락이 필요하다. Hermes를 붙이면 알림이 바로 runbook 실행으로 이어진다.</p><h3 id="2-%EC%84%9C%EB%B9%84%EC%8A%A4-%EB%A7%B5%EC%9D%B4-%EC%A4%91%EC%9A%94%ED%95%98%EB%8B%A4">2. 서비스 맵이 중요하다</h3><p>LLM 에이전트에게 SSH 권한만 준다고 운영자가 되는 건 아니다. 어떤 도메인이 어떤 노드/컨테이너와 연결되는지 알려줘야 한다. 이 서비스 맵이 없으면 진단 범위가 너무 넓어진다.</p><h3 id="3-%EC%9E%90%EB%8F%99%EB%B3%B5%EA%B5%AC%EC%97%90%EB%8A%94-%EA%B2%BD%EA%B3%84%EA%B0%80-%ED%95%84%EC%9A%94%ED%95%98%EB%8B%A4">3. 자동복구에는 경계가 필요하다</h3><p>컨테이너 하나가 명확히 죽은 경우 재시작은 괜찮다. 하지만 DB restore, 볼륨 삭제, 방화벽 변경 같은 작업은 자동화하면 위험하다. 자동복구는 “할 수 있는 것”보다 “하면 안 되는 것”을 더 명확히 해야 한다.</p><h3 id="4-docker-bridge%EC%99%80-firewall%EC%9D%80-%EC%83%9D%EA%B0%81%EB%B3%B4%EB%8B%A4-%EC%9E%90%EC%A3%BC-%EB%B0%9C%EB%AA%A9%EC%9D%84-%EC%9E%A1%EB%8A%94%EB%8B%A4">4. Docker bridge와 firewall은 생각보다 자주 발목을 잡는다</h3><p>Uptime Kuma가 Docker 안에 있으면 <code>127.0.0.1</code>로 host의 Hermes webhook에 접근할 수 없다. 실제 bridge gateway IP에 bind하고, 필요한 경우 해당 bridge interface에서 8644 포트만 허용해야 한다.</p><h3 id="5-dns-%EB%AA%A8%EB%8B%88%ED%84%B0%EB%A7%81%EC%9D%80-dns-%EC%9E%A5%EC%95%A0%EC%97%90-%EC%B7%A8%EC%95%BD%ED%95%98%EB%8B%A4">5. DNS 모니터링은 DNS 장애에 취약하다</h3><p><code>npm.yeoun.org</code> 사례처럼, 모니터가 내부 DNS에 의존하면 DNS 장애 때 모니터 자체도 눈이 멀 수 있다. 중요한 서비스는 IP + Host header 방식이나 fallback DNS를 고려할 필요가 있다.</p><h2 id="%EB%B3%B4%EC%95%88-%EB%A9%94%EB%AA%A8">보안 메모</h2><p>이 구조는 강력하지만 권한도 크다. 최소한 아래는 지키는 게 좋다.</p><ul><li>webhook secret 사용</li><li>Uptime Kuma → Hermes 경로는 Docker bridge 내부로 제한</li><li>Hermes가 쓸 SSH 계정의 권한 최소화</li><li>자동 재시작 허용 범위 명시</li><li>destructive command는 승인 필요</li><li>Discord/로그/블로그에는 token, webhook URL secret, DB password를 남기지 않기</li></ul><h2 id="%ED%98%84%EC%9E%AC-%EB%82%A8%EC%9D%80-%EA%B0%9C%EC%84%A0%EC%A0%90">현재 남은 개선점</h2><p>내 기준 다음 단계는 이렇다.</p><ol><li>Uptime Kuma 호스트의 DNS fallback 구성</li><li>내부 DNS 의존 서비스는 IP + Host header 모니터 추가</li><li>Hermes 자동복구 결과를 정형 JSON으로도 저장</li><li>복구 로그를 Obsidian뿐 아니라 Git repo에도 append</li><li>자주 발생하는 장애 유형별 playbook 분리</li></ol><h2 id="%EA%B2%B0%EB%A1%A0">결론</h2><p>이 파이프라인의 핵심은 “LLM으로 서버를 마법처럼 고친다”가 아니다. 핵심은 훨씬 현실적이다.</p><ul><li>Uptime Kuma가 장애를 감지한다.</li><li>Hermes가 정해진 runbook과 서비스 맵을 기반으로 진단한다.</li><li>안전한 범위에서만 복구한다.</li><li>결과를 Discord와 Obsidian에 남긴다.</li></ul><p>작은 홈서버라도 서비스가 많아지면 장애 원인 파악에 시간이 꽤 든다. 이 구조는 그 시간을 줄여준다. 특히 단순한 <code>502</code> 뒤에 숨어 있는 “DNS 재시작”, “프록시 정상”, “앱 컨테이너 다운” 같은 차이를 자동으로 구분해주는 점이 가장 실용적이었다.</p><p>운영 자동화는 거창한 플랫폼에서 시작하지 않아도 된다. Uptime Kuma, Docker, SSH, 그리고 도구를 쓸 줄 아는 에이전트 하나면 꽤 쓸만한 홈랩 incident-response 파이프라인을 만들 수 있다.</p>


---
title: "MOA dev 인프라 CI/CD와 인증 흐름 정리"
published: 2026-06-06
description: "MOA/SW-HUB dev 인프라에서 GitHub Actions, AWS OIDC, Terraform, Cloudflare Tunnel, EC2 런타임 인증을 어떻게 분리했는지 정리했다."
lang: "ko"
draft: false
category: "DevOps / Infrastructure"
tags: ["MOA-CREW", "CI/CD", "GitOps", "Terraform", "GitHub Actions", "OIDC", "AWS", "IAM", "STS", "Cloudflare", "RDS", "S3", "EC2", "IMDSv2"]
---

인프라 자동화에서 가장 신경 쓰이는 부분은 “자동으로 배포된다” 자체가 아니다. 진짜 질문은 따로 있다.

> CI가 클라우드에 들어갈 권한을 어떻게 얻고, 그 권한은 어디까지 열려 있는가?

MOA/SW-HUB dev 인프라의 Terraform GitOps 파이프라인을 정리하면서 잡은 핵심 원칙은 하나였다.

> **인프라 배포 경로, 즉 CI에서 AWS로 들어가는 경로에는 영구 액세스 키를 두지 않는다.**

GitHub Actions에 `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`를 저장하는 대신, GitHub OIDC와 AWS STS를 이용해 매 실행마다 짧게 살아있는 임시 자격 증명을 발급받는 구조로 만들었다.

## 먼저 용어부터 정리하기

이 흐름을 이해하려면 GitHub Actions, OIDC, AWS STS가 각각 무슨 역할을 하는지 먼저 잡아야 한다. 세 개를 한 문장으로 줄이면 이렇다.

```text
GitHub Actions = 일을 실행하는 CI 러너
OIDC           = GitHub가 “이 실행은 이 레포의 이 워크플로가 맞다”고 증명하는 신원 증명 방식
AWS STS        = 그 증명을 보고 AWS 임시 자격 증명을 발급하는 서비스
```

### GitHub Actions

**GitHub Actions**는 GitHub 안에서 CI/CD 작업을 실행하는 자동화 플랫폼이다. PR이 열리거나, 특정 브랜치에 push되거나, 수동으로 워크플로를 실행할 때 GitHub가 러너를 띄우고 YAML에 적힌 작업을 수행한다.

이 글에서는 GitHub Actions가 Terraform을 실행하는 주체다.

```text
PR 생성
  -> GitHub Actions runner 실행
  -> terraform plan
  -> PR 코멘트 작성

dev 브랜치 push
  -> GitHub Actions runner 실행
  -> 승인 게이트 통과
  -> terraform apply
```

여기서 중요한 점은 러너가 매번 새로 뜨는 실행 환경이라는 것이다. 그래서 러너가 AWS에 접근하려면 어떤 방식으로든 AWS 자격 증명을 얻어야 한다.

가장 단순한 방식은 GitHub Secrets에 AWS access key를 넣는 것이다. 하지만 이 방식은 장기 키를 CI에 보관하게 된다. 이번 구조에서는 그 대신 OIDC를 사용했다.

### OIDC

**OIDC, OpenID Connect**는 한 시스템이 다른 시스템에게 “이 사용자가 누구인지” 또는 “이 실행이 어떤 주체인지”를 증명할 때 쓰는 인증 계층이다. OAuth 2.0 위에 identity layer를 얹은 방식이라고 볼 수 있다.

GitHub Actions에서는 워크플로 실행 중에 GitHub가 OIDC 토큰, 정확히는 짧게 살아있는 JWT를 발급한다. 이 토큰 안에는 이 실행이 어떤 레포, 어떤 브랜치, 어떤 워크플로에서 왔는지 같은 클레임이 들어간다.

예를 들어 이번 구조에서 중요한 클레임은 이런 형태다.

```text
issuer   = token.actions.githubusercontent.com
audience = sts.amazonaws.com
subject  = repo:MOA-Crew/iac:*
```

AWS는 이 토큰을 보고 “정말 GitHub가 발급한 토큰인가?”, “AWS STS를 대상으로 발급된 토큰인가?”, “내가 신뢰하기로 한 레포에서 온 실행인가?”를 확인한다.

즉 OIDC는 GitHub Actions가 AWS에 비밀번호를 넘기는 방식이 아니라, **GitHub가 서명한 신원 증명서를 AWS에 제시하는 방식**에 가깝다.

### AWS STS

**AWS STS, Security Token Service**는 AWS에서 임시 보안 자격 증명을 발급하는 서비스다. 장기 access key를 직접 쓰는 대신, 특정 조건을 만족한 주체에게 짧은 시간 동안만 유효한 access key, secret access key, session token을 발급한다.

이번 흐름에서는 GitHub Actions가 OIDC 토큰을 AWS STS에 제시하고, STS는 `AssumeRoleWithWebIdentity`를 통해 IAM role의 임시 자격 증명을 발급한다.

```text
GitHub Actions
  -> OIDC JWT 제시
  -> AWS STS AssumeRoleWithWebIdentity 호출
  -> IAM role 신뢰 정책 검사
  -> 통과하면 임시 자격 증명 발급
```

이 임시 자격 증명은 보통 짧은 시간만 유효하다. 그래서 유출되더라도 장기 키보다 피해 범위를 줄일 수 있고, role의 policy로 어떤 AWS 리소스에 접근할 수 있는지도 제한할 수 있다.

### 세 개를 연결하면

세 도구의 관계를 다시 정리하면 이렇다.

<table>
  <thead>
    <tr><th>구성 요소</th><th>역할</th><th>이 글에서의 의미</th></tr>
  </thead>
  <tbody>
    <tr><td>GitHub Actions</td><td>CI/CD 실행기</td><td>Terraform plan/apply를 실행하는 러너</td></tr>
    <tr><td>OIDC</td><td>신원 증명 방식</td><td>GitHub 실행이 신뢰한 레포에서 왔다는 것을 JWT로 증명</td></tr>
    <tr><td>AWS STS</td><td>임시 자격 증명 발급 서비스</td><td>OIDC 토큰을 검증한 뒤 Terraform용 IAM role credential 발급</td></tr>
  </tbody>
</table>

결국 이 구조는 “GitHub에 AWS 비밀번호를 저장한다”가 아니라, **GitHub가 자신의 실행 신원을 증명하고 AWS가 그 신원을 믿을 때만 짧은 권한을 빌려주는 구조**다.

## 전체 흐름

현재 dev 인프라 배포 흐름은 다음과 같다.

```text
[개발자]
  PR 또는 dev 브랜치 머지 (MOA-Crew/iac)
        |
        v
[GitHub Actions Runner]
  1. GitHub OIDC provider에 단기 JWT 요청
     - issuer: token.actions.githubusercontent.com
     - audience: sts.amazonaws.com
     - subject: repo:MOA-Crew/iac:*
        |
        v
[AWS STS]
  2. AssumeRoleWithWebIdentity
     - JWT 서명 검증
     - aud 검증
     - sub 신뢰 정책 검증
        |
        v
[IAM Role: sw-hub-dev-gha-terraform]
  3. 약 1시간짜리 임시 자격 증명 발급
        |
        v
[Terraform]
  - AWS 리소스: OIDC 임시 자격 증명 사용
  - S3 remote state: OIDC 임시 자격 증명 사용
  - Cloudflare 리소스: GitHub Secret의 CLOUDFLARE_API_TOKEN 사용
```

핵심은 GitHub Actions 러너가 장기 AWS 키를 들고 있지 않다는 점이다. 러너는 실행 시점에 GitHub OIDC 토큰을 받고, AWS는 그 토큰의 클레임이 IAM role의 신뢰 정책과 맞을 때만 임시 권한을 발급한다.

즉 “시크릿을 CI에 넣어두고 오래 쓰는 방식”이 아니라, **GitHub 레포와 AWS role 사이의 신뢰 관계를 기반으로 매번 짧은 권한을 빌려 쓰는 방식**이다.

## PR은 plan, dev 머지는 apply

인프라 변경은 이벤트별로 다르게 처리했다.

<table>
  <thead>
    <tr><th>이벤트</th><th>동작</th><th>의도</th></tr>
  </thead>
  <tbody>
    <tr><td>Pull Request</td><td><code>terraform plan</code> 실행 후 PR 코멘트 작성</td><td>리뷰 단계에서 변경 내용을 먼저 확인</td></tr>
    <tr><td><code>dev</code> 브랜치 push</td><td><code>terraform apply</code> 시도</td><td>리뷰가 끝난 변경을 dev 인프라에 반영</td></tr>
    <tr><td><code>dev-apply</code> GitHub Environment</td><td>수동 승인 게이트</td><td>실제 인프라 변경 전 사람 확인 추가</td></tr>
  </tbody>
</table>

자동화는 하되, `apply`를 완전 무인으로 열어두지는 않았다. 인프라 변경은 비용, 장애, 보안 그룹, 데이터베이스 설정에 바로 영향을 줄 수 있다. 그래서 `dev`에 머지된 뒤에도 GitHub Environment의 `dev-apply` 승인 게이트를 거치게 했다.

워크플로는 `terraform/**`, `.github/workflows/terraform.yml`이 바뀔 때만 동작하도록 경로 필터도 걸었다. 애플리케이션 코드 변경과 인프라 변경 파이프라인을 분리하기 위해서다.

운영하면서 주의할 점도 하나 있었다. PR에 머지 충돌이 있으면 GitHub가 PR용 merge ref를 만들지 못해서 워크플로 자체가 트리거되지 않을 수 있다. 이 경우에는 CI 설정 문제가 아니라 먼저 충돌을 해소해야 한다.

## 자격 증명은 어디에 있는가

dev 환경의 인증 경계는 다음처럼 나뉜다.

<table>
  <thead>
    <tr><th>경로</th><th>인증 수단</th><th>장기 키 여부</th></tr>
  </thead>
  <tbody>
    <tr><td>GitHub Actions → AWS</td><td>GitHub OIDC + AWS STS 임시 자격 증명</td><td>없음</td></tr>
    <tr><td>GitHub Actions → Cloudflare</td><td><code>CLOUDFLARE_API_TOKEN</code> GitHub Secret</td><td>있음</td></tr>
    <tr><td>Terraform state</td><td>S3 backend, OIDC 임시 자격 증명으로 접근</td><td>없음</td></tr>
    <tr><td>BE 배포 CI → EC2</td><td>BE 레포 GitHub Secret의 SSH private key</td><td>있음</td></tr>
    <tr><td>EC2 앱 → RDS</td><td>DB 접속 정보가 담긴 서버 env 파일</td><td>있음</td></tr>
    <tr><td>EC2 앱 → S3</td><td>EC2 Instance Profile</td><td>없음</td></tr>
    <tr><td>EC2 → Cloudflare Tunnel</td><td>cloudflared tunnel token</td><td>있음</td></tr>
  </tbody>
</table>

모든 비밀을 없앤 것은 아니다. Cloudflare API token, SSH key, DB password, tunnel token은 아직 필요하다. 대신 권한이 강한 **AWS 인프라 배포 경로**와 애플리케이션의 **S3 접근 경로**에서는 장기 액세스 키를 제거했다.

이 차이가 중요하다. 인프라 배포 권한은 강하다. 여기에 장기 키가 들어가면 유출 시 피해 범위가 커진다. OIDC 기반 임시 자격 증명은 실행 시점, 레포, subject 조건으로 권한 경계를 더 좁힐 수 있다.

## 런타임 인증은 인프라 배포와 분리한다

애플리케이션 배포와 런타임 인증은 Terraform GitOps 파이프라인과 별도로 둔다.

```text
[MOA-Crew/BE dev 머지]
        |
        v
[BE CI]
  jar build
        |
        v
[BE CD]
  SSH key로 EC2 접속
        |
        v
[EC2]
  docker run moa-be
  - RDS 접속: 서버 env 파일
  - S3 접근: instance profile
  - IMDSv2 강제
  - cloudflared: Cloudflare Tunnel로 outbound 연결
        |
        v
[외부 사용자]
  https://moa.yeoun.org
```

EC2의 AWS 접근은 instance profile을 사용한다. 애플리케이션 컨테이너 안에 AWS access key를 굽거나 env로 넣지 않는다. EC2에 IAM role을 붙이고, 애플리케이션은 AWS SDK의 기본 credential chain을 통해 임시 자격 증명을 사용한다.

또한 IMDSv2를 강제해 토큰 없는 메타데이터 접근을 막았다. SSRF 같은 취약점이 생겼을 때 metadata endpoint가 바로 털리는 위험을 줄이기 위한 기본 방어선이다.

외부 트래픽은 EC2의 80/443/8080 포트를 직접 여는 대신 Cloudflare Tunnel을 통해 받는다. EC2에서는 `cloudflared`가 Cloudflare로 outbound 연결을 맺고, 사용자는 Cloudflare edge TLS를 통해 서비스에 접근한다. 운영 관점에서는 EC2의 직접 노출면을 줄이는 방향이다.

## 부트스트랩은 사람이 한 번 만든다

OIDC 파이프라인도 처음부터 혼자 생기지는 않는다. CI가 AWS에 들어갈 권한을 얻으려면, 그 권한의 뿌리는 먼저 사람이 만들어야 한다.

부트스트랩 단계에서 만든 것은 다음과 같다.

- Terraform state용 S3 bucket: 버전 관리, 암호화, public access block, S3 네이티브 lockfile 사용
- GitHub OIDC provider: `token.actions.githubusercontent.com`, audience `sts.amazonaws.com`
- CI role: `sw-hub-dev-gha-terraform`
- CI role trust policy: `repo:MOA-Crew/iac:*` subject와 `sts.amazonaws.com` audience 조건
- CI role inline policy: dev Terraform에 필요한 EC2/RDS/S3/IAM 범위 권한
- GitHub Environment: `dev-apply`, reviewer와 dev 브랜치 제한
- GitHub Secrets: Cloudflare API token과 Terraform 변수 값들

여기서 CI role과 OIDC provider는 “CI가 인프라를 만들기 위한 권한”이다. 그래서 파이프라인이 자기 자신의 루트 권한을 전부 만드는 구조로 두지 않고, 부트스트랩 단계에서 관리자 권한으로 한 번 만들어 둔다.

## 드리프트와 자동 교체 방지

기존에 수동 또는 외부에서 만들어진 리소스를 Terraform 관리로 편입하면서 드리프트 처리도 필요했다.

<table>
  <thead>
    <tr><th>리소스</th><th>문제</th><th>처리</th></tr>
  </thead>
  <tbody>
    <tr><td>Cloudflare Tunnel</td><td>터널 secret은 API로 다시 읽을 수 없어 매 apply마다 변경으로 잡힐 수 있음</td><td><code>lifecycle { ignore_changes = [secret] }</code></td></tr>
    <tr><td>RDS</td><td><code>auto_minor_version_upgrade</code>로 올라간 engine version을 Terraform이 되돌리려 할 수 있음</td><td><code>ignore_changes = [engine_version]</code></td></tr>
    <tr><td>EC2</td><td><code>most_recent</code> AMI가 바뀌면 인스턴스 교체가 발생할 수 있음</td><td><code>ignore_changes = [ami]</code></td></tr>
  </tbody>
</table>

이 설정들은 Terraform을 포기한다는 뜻이 아니다. 운영 중 자동 교체나 불필요한 재생성을 막기 위해 **의도적으로 변경 감지를 제한한 부분**이다.

예를 들어 Cloudflare Tunnel secret을 의도적으로 회전해야 한다면 해당 `ignore_changes`를 풀고 토큰 재발급 절차를 밟아야 한다. RDS engine version도 마찬가지다. 자동 마이너 업그레이드는 받아들이되, Terraform이 이를 억지로 되돌리려 하지 않게 만든 것이다.

## 정리

이번 CI/CD 인증 흐름의 핵심은 자동화보다 **권한 경계**다.

```text
GitHub Actions → AWS
  장기 키 없음
  OIDC + STS 임시 자격 증명

Terraform apply
  dev 브랜치 반영 후에도 수동 승인 게이트

EC2 앱 → S3
  access key 없음
  instance profile 사용

외부 → EC2
  직접 포트 노출 최소화
  Cloudflare Tunnel 사용
```

결국 목표는 “CI가 알아서 apply한다”가 아니라, **누가 어떤 조건에서 어떤 권한을 임시로 얻고, 어디에서 사람이 개입해야 하는지 명확하게 만드는 것**이다.

인프라 자동화는 편하지만, 권한 모델이 흐리면 위험해진다. 이번 dev 파이프라인은 그 위험을 줄이기 위해 AWS 장기 키를 제거하고, GitHub OIDC 신뢰 관계와 수동 승인 게이트를 조합한 구조로 정리했다.

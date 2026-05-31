---
title: "MOA CREW IaC 레포를 만들며: Terraform과 Ansible은 왜 필요한가"
published: 2026-05-31
description: "MOA/SW-HUB 프로젝트의 AWS dev 인프라를 Terraform과 Ansible로 코드화하고, 계정 이전까지 20분 미만으로 재현한 기록."
lang: "ko"
draft: false
category: "DevOps / Infrastructure"
tags: ["IaC", "Terraform", "Ansible", "AWS", "IAM", "RDS", "S3", "EC2", "VPC", "Subnet", "Docker", "AWS CLI", "MOA-CREW"]
---

인프라를 직접 운영하다 보면 어느 순간 이런 질문을 마주한다.

> “서버 한두 대는 손으로 세팅해도 되는데, 이걸 팀 프로젝트나 다른 계정에서 다시 만들어야 하면 어떻게 하지?”

MOA CREW 조직의 `iac` 레포를 만든 이유도 여기에 가깝다. 서버를 한 번 잘 세팅하는 것보다 더 중요한 건, **그 상태를 다시 만들 수 있고, 변경 이력을 남길 수 있고, 여러 사람이 같은 기준으로 운영할 수 있게 만드는 것**이다.

이번 작업의 핵심은 단순했다.

> 서버를 수동 세팅하지 않고, MOA/SW-HUB 프로젝트의 AWS dev 인프라를 코드로 재현 가능하게 만들기.

실제로 이 구조 덕분에 개인 AWS 계정에 먼저 구성했던 인프라를 지원 AWS 계정으로 옮겨야 했을 때, 기존 IaC 레포를 활용해 **20분도 걸리지 않아 EC2/RDS/S3/IAM 기반 dev 인프라를 다시 만들 수 있었다.**

## 먼저 전체 그림

이번에 코드화한 범위는 대략 이렇다.

<table>
  <thead>
    <tr><th>영역</th><th>한 일</th><th>의미</th></tr>
  </thead>
  <tbody>
    <tr><td>Terraform</td><td>VPC, Subnet, EC2, RDS, S3, IAM 구성</td><td>클라우드 리소스를 코드로 선언</td></tr>
    <tr><td>Ansible</td><td>Docker, AWS CLI, zram, timezone, PostgreSQL client 설정</td><td>EC2 내부 런타임 상태 자동화</td></tr>
    <tr><td>IAM/S3</td><td>EC2 Instance Profile 기반 S3 접근</td><td>정적 AWS key 없이 안전하게 접근</td></tr>
    <tr><td>운영</td><td>개인 AWS 계정에서 지원 AWS 계정으로 이전</td><td>인프라 재현성 검증</td></tr>
    <tr><td>비용</td><td>RDS, S3, Vercel, SES 등 리소스 비용 흐름 관리</td><td>산학 프로젝트 운영 책임 수행</td></tr>
  </tbody>
</table>

구조를 단순화하면 다음과 같다.

```text
사용자 / 프론트엔드
        |
        v
[EC2 App] -- Security Group --> [Private RDS PostgreSQL]
        |
        | IAM Instance Profile (정적 키 X)
        v
[Private S3: uploads / backups]

Terraform: AWS 리소스 생성
Ansible  : EC2 내부 런타임 구성
```

여기서 중요한 포인트는 “AWS를 클릭해서 만들었다”가 아니라, **어떤 리소스가 왜 필요한지 코드로 남겼다**는 점이다.

## IaC란 무엇인가

**IaC, Infrastructure as Code**는 말 그대로 인프라를 코드로 관리하는 방식이다.

예전 방식은 이랬다.

```text
서버 접속
→ 패키지 설치
→ 방화벽 설정
→ Docker 설치
→ compose 파일 복사
→ 서비스 실행
→ 문제가 생기면 기억을 더듬어서 수정
```

이 방식은 처음에는 빠르다. 하지만 시간이 지나면 문제가 생긴다.

- 누가 어떤 설정을 바꿨는지 모른다.
- 새 서버를 만들 때 같은 상태를 재현하기 어렵다.
- 운영 환경과 개발 환경이 점점 달라진다.
- 장애가 났을 때 “원래 어떻게 되어 있었지?”부터 추적해야 한다.

IaC는 이 문제를 코드와 Git으로 끌어온다.

```text
인프라 상태
→ 코드로 선언
→ Git에 저장
→ 리뷰 / 커밋 / 롤백 가능
→ 필요하면 다시 실행해서 재현
```

핵심은 자동화 자체보다 **재현 가능성**이다. 자동화는 그 결과로 따라온다.

## Terraform은 무엇인가

Terraform은 HashiCorp가 만든 IaC 도구다. 공식 문서에서는 Terraform을 클라우드와 온프레미스 리소스를 안전하고 효율적으로 빌드, 변경, 버전 관리할 수 있는 infrastructure as code 도구로 설명한다.

쉽게 말하면 Terraform은 이런 종류의 일을 맡는다.

```text
무엇을 만들 것인가?
├─ VPC / Subnet
├─ Security Group
├─ EC2
├─ RDS PostgreSQL
├─ S3 Bucket
├─ IAM Role / Policy / Instance Profile
└─ 기타 클라우드 리소스
```

Terraform의 핵심은 **선언형**이라는 점이다.

```hcl
resource "aws_instance" "app" {
  ami           = var.ami_id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public.id

  iam_instance_profile = aws_iam_instance_profile.app.name
}
```

이 코드는 “콘솔에서 어떤 버튼을 어떤 순서로 누른다”가 아니라, **EC2 인스턴스가 이런 상태로 존재해야 한다**는 선언에 가깝다.

Terraform은 현재 상태와 코드에 적힌 목표 상태를 비교해서 무엇을 만들고, 바꾸고, 삭제해야 하는지 계산한다.

```text
현재 상태
  EC2 없음
  RDS 없음
  S3 없음

목표 상태
  App EC2 1대 필요
  Private RDS PostgreSQL 필요
  Private S3 bucket 필요
  EC2가 S3에 접근할 IAM Role 필요

terraform plan
  + EC2 생성
  + RDS 생성
  + S3 생성
  + IAM Role / Policy / Instance Profile 생성
```

그래서 Terraform은 보통 **프로비저닝**에 강하다. 여기서 프로비저닝은 서버, 네트워크, 데이터베이스, 스토리지 같은 인프라 자원을 준비하는 일을 말한다.

### MOA 프로젝트에서 Terraform이 맡은 일

이번 MOA/SW-HUB dev 인프라에서는 Terraform이 다음 책임을 맡았다.

- EC2 애플리케이션 서버 준비
- RDS PostgreSQL을 private하게 구성
- S3 bucket을 private하게 구성
- EC2가 S3에 접근할 수 있도록 IAM Role / Policy / Instance Profile 구성
- Security Group으로 EC2와 RDS 접근 관계 제어
- 계정이 바뀌어도 같은 구조를 다시 만들 수 있게 코드화

특히 S3 접근을 정적 access key로 처리하지 않고, **EC2 Instance Profile 기반으로 처리한 점**이 중요하다.

```text
나쁜 방향
  애플리케이션 서버에 AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 저장

더 나은 방향
  EC2에 IAM Role 부여
  애플리케이션은 Instance Metadata를 통해 임시 자격 증명 사용
```

정적 키를 서버 안에 오래 들고 있는 구조는 유출 위험이 커진다. 반면 Instance Profile은 EC2에 역할을 붙이고, AWS가 임시 자격 증명을 관리한다. 운영 관점에서 훨씬 안전하다.

## Ansible은 무엇인가

Ansible은 서버 설정과 배포 자동화에 많이 쓰이는 도구다.

Terraform이 “서버와 네트워크를 만든다” 쪽에 가깝다면, Ansible은 “이미 존재하는 서버를 원하는 상태로 맞춘다” 쪽에 가깝다.

```text
서버 안에서 무엇을 맞출 것인가?
├─ apt 패키지 업데이트
├─ Docker 설치
├─ AWS CLI 설치
├─ zram / swappiness 설정
├─ timezone 설정
├─ PostgreSQL client 설치
├─ Docker log limit 설정
└─ 애플리케이션 배포 준비
```

Ansible은 YAML 기반의 playbook을 사용한다.

```yaml
- name: Configure app server
  hosts: app_servers
  become: true
  tasks:
    - name: Install Docker
      apt:
        name: docker.io
        state: present
        update_cache: true
```

읽어보면 거의 운영 절차서처럼 보인다. 하지만 사람이 손으로 치는 절차서와 다르게, 이 파일은 반복 실행할 수 있고 Git에 남길 수 있다.

### MOA 프로젝트에서 Ansible이 맡은 일

이번 인프라에서 Ansible은 EC2 내부 상태를 맞추는 역할이었다.

<table>
  <thead>
    <tr><th>설정</th><th>왜 필요한가</th></tr>
  </thead>
  <tbody>
    <tr><td>Docker</td><td>애플리케이션을 컨테이너로 실행하기 위한 기본 런타임</td></tr>
    <tr><td>AWS CLI</td><td>S3 접근, 운영 확인, 배포 스크립트에서 AWS API 호출</td></tr>
    <tr><td>zram / swappiness</td><td>작은 인스턴스에서 메모리 압박을 완화하고 안정성 확보</td></tr>
    <tr><td>timezone</td><td>로그와 장애 시각을 한국 시간 기준으로 맞추기 위함</td></tr>
    <tr><td>PostgreSQL client</td><td>EC2에서 RDS 접속 확인과 운영 작업 수행</td></tr>
    <tr><td>Docker log limit</td><td>컨테이너 로그가 디스크를 계속 잡아먹는 문제 방지</td></tr>
  </tbody>
</table>

여기서 zram이나 Docker log limit 같은 설정은 사소해 보이지만, 실제 운영에서는 꽤 중요하다. 작은 인스턴스는 메모리와 디스크가 먼저 터진다. “서버가 느려졌다”의 원인이 애플리케이션 코드가 아니라 로그 파일 폭주나 swap 부재일 때도 많다.

즉 Ansible은 단순 설치 스크립트가 아니라, **운영하면서 배운 서버 안정화 지식을 코드로 남기는 도구**에 가깝다.

## Terraform과 Ansible은 역할이 다르다

둘 다 IaC 도구라서 처음에는 겹쳐 보인다. 하지만 실제 운영에서는 역할이 꽤 다르다.

<table>
  <thead>
    <tr><th>구분</th><th>Terraform</th><th>Ansible</th></tr>
  </thead>
  <tbody>
    <tr><td>주 역할</td><td>인프라 리소스 생성/변경</td><td>서버 설정/배포 자동화</td></tr>
    <tr><td>관심 대상</td><td>VPC, EC2, RDS, S3, IAM, Security Group</td><td>패키지, 설정 파일, 서비스, 컨테이너</td></tr>
    <tr><td>방식</td><td>목표 상태 선언</td><td>작업 절차 실행</td></tr>
    <tr><td>상태 관리</td><td>state 파일로 리소스 상태 추적</td><td>대상 서버에 접속해 작업 수행</td></tr>
    <tr><td>강점</td><td>리소스 생성과 변경 계획 확인</td><td>운영 작업 자동화와 반복 적용</td></tr>
  </tbody>
</table>

내 기준으로는 이렇게 나누는 게 가장 직관적이다.

```text
Terraform
  "AWS에 어떤 리소스가 있어야 하는지 정의한다"

Ansible
  "그 리소스 안에서 서버가 어떤 상태여야 하는지 맞춘다"
```

MOA dev 인프라 흐름으로 보면 이렇게 된다.

```text
1. Terraform
   ├─ VPC / Subnet / Security Group 구성
   ├─ EC2 App 서버 생성
   ├─ Private RDS PostgreSQL 생성
   ├─ Private S3 bucket 생성
   └─ IAM Role / Policy / Instance Profile 연결

2. Ansible
   ├─ EC2 접속
   ├─ Docker / AWS CLI / PostgreSQL client 설치
   ├─ zram / swappiness / timezone 설정
   ├─ Docker log limit 적용
   └─ 애플리케이션 실행 준비

3. 검증
   ├─ EC2에서 RDS 접속 확인
   ├─ EC2에서 S3 접근 확인
   └─ 애플리케이션이 외부 요청을 받을 수 있는지 확인
```

## 실제로 도움이 됐던 순간: AWS 계정 이전

이번 작업의 가치는 실제 이전 상황에서 드러났다.

처음에는 개인 AWS 계정에 dev 인프라를 구성했다. 이후 지원 AWS 계정으로 인프라를 옮겨야 하는 상황이 생겼다. 수동으로 클릭해서 만들었다면 다시 콘솔을 열고 기억을 더듬어야 했을 것이다.

IaC 레포가 있으니 흐름은 훨씬 단순했다.

```text
개인 AWS 계정
  terraform state 확인
        |
        v
  terraform destroy
        |
        v
지원 AWS 계정 credentials 적용
        |
        v
  terraform apply
        |
        +--> iam:PassRole 계정 ID 문제 수정
        |
        v
  ansible site.yml 재적용
        |
        v
EC2 / RDS / S3 / IAM 재현
        |
        v
EC2 Instance Profile 기반 S3 접근 검증

결과: 한 번 세팅해둔 IaC 레포 덕분에
      계정 마이그레이션이 20분도 안 걸림
```

이 과정에서 `iam:PassRole` 오류도 만났다. IAM Role을 EC2에 붙이려면, 실행 주체에게 해당 Role을 넘겨줄 권한이 있어야 한다. 계정이 바뀌면 ARN 안의 account id도 바뀌기 때문에, policy가 특정 계정 ID에 묶여 있으면 그대로 실패할 수 있다.

```text
iam:PassRole 오류의 본질
  "이 사용자가 이 IAM Role을 EC2에 넘겨줘도 되는가?"
```

결국 계정 ID에 맞게 IAM policy를 수정하고, EC2 Instance Profile 기반 S3 접근까지 확인했다. 이건 단순히 “Terraform apply 성공”보다 더 의미가 크다. **권한 모델까지 포함해서 인프라가 실제로 동작하는지 검증했다**는 뜻이기 때문이다.

문제와 해결을 정리하면 이렇다.

<table>
  <thead>
    <tr><th>문제</th><th>해결</th></tr>
  </thead>
  <tbody>
    <tr><td>개인 계정에 먼저 인프라가 생성됨</td><td>Terraform state 확인 후 destroy로 리소스 정리</td></tr>
    <tr><td>지원 AWS 계정으로 이전 필요</td><td>같은 IaC 코드로 20분 미만 재생성</td></tr>
    <tr><td>iam:PassRole 오류 발생</td><td>IAM policy의 계정 ID와 Role 전달 권한 수정</td></tr>
    <tr><td>S3 접근 검증 필요</td><td>EC2 Instance Profile 기반 접근 확인</td></tr>
    <tr><td>서버 런타임 재세팅 필요</td><td>Ansible site playbook으로 Docker/AWS CLI/zram 등 재적용</td></tr>
  </tbody>
</table>

## 왜 굳이 IaC 레포가 필요한가

MOA CREW 같은 조직 단위 프로젝트에서는 “내 컴퓨터에서는 됨”보다 더 무서운 게 있다.

> “내 서버에서는 되는데, 왜 새 서버에서는 안 되지?”

서버 설정이 사람 머릿속에 있으면 시간이 지날수록 부채가 된다. 처음에는 빠르게 느껴지지만, 노드가 늘거나 팀원이 합류하거나 장애가 나면 비용이 폭발한다.

IaC 레포는 이 부채를 줄이는 장치다.

### 1. 인프라 변경 이력이 남는다

서버에서 직접 설정을 바꾸면 기록이 흐려진다. 반면 IaC 레포에서는 변경이 커밋으로 남는다.

```text
git diff
terraform plan
ansible-playbook --check
```

이런 단계가 생기면, 변경 전에 무엇이 바뀔지 볼 수 있다.

### 2. 새 환경을 빠르게 재현할 수 있다

이번 계정 이전이 좋은 예시다. 이미 코드가 있으니 새 AWS 계정에서도 같은 구조를 다시 만들 수 있었다.

```text
기존 방식
  콘솔을 보며 VPC/EC2/RDS/S3/IAM을 다시 클릭
  → 누락 가능성 높음
  → 보안 그룹이나 IAM policy 실수 가능성 높음

IaC 방식
  credentials 변경
  → terraform plan
  → terraform apply
  → ansible-playbook site.yml
  → 검증
```

결과적으로 계정 이전은 20분 미만으로 끝났다. 이게 IaC의 가장 현실적인 장점이다. 멋있는 단어가 아니라, **실제로 시간을 줄이고 실수를 줄인다.**

### 3. 보안 기준을 코드로 강제할 수 있다

이번 구조에서는 다음 기준을 코드에 녹였다.

- RDS는 private하게 둔다.
- S3는 private bucket으로 둔다.
- EC2에서 S3 접근은 정적 키가 아니라 IAM Role로 처리한다.
- Security Group으로 필요한 연결만 허용한다.

사람이 콘솔에서 매번 클릭하면 언젠가 빠뜨린다. 코드로 만들면 최소한 리뷰할 수 있고, diff로 볼 수 있다.

### 4. 운영 지식이 팀 자산이 된다

운영 지식이 한 사람의 머릿속에만 있으면 그건 시스템이 아니라 암묵지다. IaC 레포는 이 암묵지를 명시지로 바꾼다.

- 어떤 포트를 열어야 하는지
- 어떤 패키지가 필요한지
- 어떤 서비스가 먼저 떠야 하는지
- 어떤 노드가 어떤 역할인지
- 어떤 IAM 권한이 필요한지
- 어떤 비용 리소스가 떠 있는지

이런 것들이 코드와 문서로 남는다.

## MOA CREW IaC 레포의 첫 목표

처음부터 완벽한 플랫폼을 만들 필요는 없다. 오히려 처음에는 작게 시작하는 게 맞다.

내가 보는 첫 목표는 이 정도다.

```text
moa-iac
├─ ansible.cfg
├─ inventory.ini
├─ site.yml
├─ playbooks/
├─ roles/
│  ├─ common/
│  │  ├─ tasks/base.yml
│  │  ├─ tasks/security.yml
│  │  ├─ tasks/docker.yml
│  │  └─ tasks/tuning.yml
│  └─ deploy_services/
└─ terraform/
   ├─ environments/
   │  └─ dev/
   └─ modules/
      ├─ network/
      ├─ compute/
      ├─ database/
      ├─ storage/
      └─ iam/
```

먼저 Ansible 쪽은 다음을 정리한다.

- `vars`와 `tasks` 분리
- 민감 정보는 `.gitignore` 또는 별도 secret 관리로 분리
- 공통 서버 설정을 `common` role로 묶기
- Docker 설치와 서비스 배포를 분리
- zram, swappiness, Docker log limit 같은 안정화 설정을 명시화
- `ansible-playbook --check`로 변경 전 확인 가능하게 만들기

Terraform 쪽은 dev 인프라 기준으로 다음처럼 나눌 수 있다.

- `network`: VPC, Subnet, Route Table, Security Group
- `compute`: EC2, Key Pair, Instance Profile 연결
- `database`: RDS PostgreSQL, Subnet Group, Parameter Group
- `storage`: S3 bucket, bucket policy, public access block
- `iam`: Role, Policy, Instance Profile, PassRole 관련 정책

이렇게 나누면 리소스가 늘어나도 “어디를 봐야 하는지”가 명확해진다.

## 주의할 점

IaC는 마법이 아니다. 잘못 쓰면 자동화된 혼돈이 된다. 이번 작업에서도 특히 조심해야 할 부분이 있었다.

### 민감 정보 관리

토큰, 비밀번호, SSH 키, API 키는 레포에 들어가면 안 된다.

```text
.env
*.pem
secrets.yml
terraform.tfvars
*.tfstate
```

이런 파일은 `.gitignore`에 넣거나, SOPS, Ansible Vault, GitHub Secrets 같은 도구로 분리해야 한다.

특히 Terraform state에는 민감 정보가 들어갈 수 있다. RDS endpoint, 일부 설정값, 리소스 식별자 등이 state에 남는다. 팀 단위로 쓸 때는 로컬 state 파일을 메신저로 주고받는 식으로 운영하면 안 된다.

### Terraform state 관리

Terraform은 state 파일로 실제 리소스 상태를 추적한다. 그래서 state가 꼬이면 코드와 실제 인프라 사이의 관계도 꼬인다.

초기에는 로컬 state로 시작할 수 있지만, 팀 단위 운영에서는 remote backend를 고민해야 한다.

```text
개인 실습
  local state 가능

팀 운영
  S3 backend + DynamoDB lock 같은 remote backend 고려
```

remote backend를 쓰면 여러 사람이 동시에 apply해서 state가 깨지는 일을 줄일 수 있다.

### IAM policy를 너무 넓게 열지 않기

급하게 문제를 해결하다 보면 `AdministratorAccess`나 `s3:*` 같은 넓은 권한을 붙이고 싶어진다. 하지만 운영에서는 나중에 반드시 부채가 된다.

이번처럼 EC2가 S3에 접근해야 한다면, 가능한 한 bucket과 action 범위를 좁히는 게 좋다.

```text
필요한 것
  특정 bucket에 대한 GetObject / PutObject

피하고 싶은 것
  모든 S3 리소스에 대한 s3:*
```

### Ansible 멱등성

Ansible playbook은 여러 번 실행해도 결과가 안정적이어야 한다. 매번 변경이 발생하거나, 실행할 때마다 상태가 흔들리면 운영 자동화로 쓰기 어렵다.

좋은 playbook은 이런 느낌이다.

```text
첫 실행: changed
두 번째 실행: ok
```

즉, 이미 원하는 상태라면 아무것도 바꾸지 않아야 한다.

## 다음 단계: 클러스터와 CI/CD

MOA CREW IaC 레포가 어느 정도 정리되면 다음 단계는 클러스터링이다.

내가 잡은 방향은 대략 이렇다.

```text
Phase 1.5
├─ Ansible role 구조 정리
├─ GitHub 업로드 및 커밋 규칙 정리
├─ 14노드 클러스터링 준비
├─ k0s 기반 Kubernetes 클러스터 구성
└─ CI/CD 도입 준비
```

여기서 k0s는 가벼운 Kubernetes 배포판이다. 여러 노드를 하나의 클러스터로 묶고, 그 위에 서비스를 배포할 수 있게 해준다.

목표는 단순히 “쿠버네티스를 써봤다”가 아니다.

```text
GitHub에 코드 push
→ GitHub Actions가 빌드
→ 이미지 생성
→ ArgoCD 또는 Ansible이 배포
→ 클러스터에 반영
```

이 흐름을 만들면 인프라와 애플리케이션 배포가 Git 중심으로 묶인다. 실수로 서버에서 직접 수정하는 대신, 변경은 코드 리뷰와 커밋을 통해 들어간다.

## 결론

MOA CREW IaC 레포는 단순히 “서버 자동화 스크립트 모음”이 아니다.

이 레포의 진짜 목적은 다음에 가깝다.

```text
운영 지식을 코드로 남기고,
서버 상태를 재현 가능하게 만들고,
팀 프로젝트의 인프라 변경을 Git 흐름 안으로 가져오는 것
```

Terraform은 AWS 리소스를 준비하고, Ansible은 EC2 내부 상태를 맞춘다. 둘을 적절히 나누면 수동 운영에서 오는 실수를 줄이고, 계정이 바뀌거나 노드가 늘어나도 같은 기준으로 인프라를 확장할 수 있다.

이번 작업의 가치는 “AWS를 써봤다”가 아니라, **실제 계정 이전, 권한, 비용, 서버 튜닝 이슈까지 포함해 인프라를 빠르게 재현 가능한 운영 체계로 만들었다는 점**이다.

지금은 작은 dev 인프라 자동화로 시작했지만, 이 구조가 정리되면 그다음은 자연스럽게 클러스터링과 CI/CD다. 결국 목표는 “서버를 잘 세팅했다”가 아니라, **인프라를 다시 만들 수 있는 팀 운영 체계**를 만드는 것이다.

## 참고 자료

- HashiCorp Developer, [What is Terraform](https://developer.hashicorp.com/terraform/intro)
- Ansible Documentation, [Ansible getting started](https://docs.ansible.com/ansible/latest/getting_started/introduction.html)
- AWS Documentation, [IAM roles for Amazon EC2](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/iam-roles-for-amazon-ec2.html)

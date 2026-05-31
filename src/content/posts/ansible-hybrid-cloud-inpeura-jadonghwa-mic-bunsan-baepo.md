---
title: '[Ansible] Hybrid Cloud 인프라 자동화 및 분산 배포'
description: 'Github : https://github.com/yeounhyeok/Ansible-IaC 1. 프로젝트 개요 및 아키텍처 설계 (Architecture & Strategy) 본 프로젝트는 OCI(Oracle Cloud Infrastructure)의 ARM/AMD 노드와 로컬 홈랩의 x86 노드(N4000, N4200)로 구성된 4대의 이기종 하드웨어를 하나의 논리적 클러스터로 통합하는 **'
published: 2026-02-14T09:05:51.000Z
draft: false
lang: ko
category: "DevOps / Automation"
tags: ["Ansible", "Hybrid Cloud", "IaC", "Distributed Deployment", "WireGuard", "Tailscale", "NFS", "Docker Compose", "Ansible Roles", "Jinja", "SSH", "Zero Trust"]
---

<hr><p>Github : <a href="https://github.com/yeounhyeok/Ansible-IaC">https://github.com/yeounhyeok/Ansible-IaC</a></p><h2 id="1-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-%EA%B0%9C%EC%9A%94-%EB%B0%8F-%EC%95%84%ED%82%A4%ED%85%8D%EC%B2%98-%EC%84%A4%EA%B3%84-architecture-strategy">1. 프로젝트 개요 및 아키텍처 설계 (Architecture &amp; Strategy)</h2><p>본 프로젝트는 OCI(Oracle Cloud Infrastructure)의 ARM/AMD 노드와 로컬 홈랩의 x86 노드(N4000, N4200)로 구성된 4대의 이기종 하드웨어를 하나의 논리적 클러스터로 통합하는 **Hybrid Cloud 인프라 구축의 1단계(Automation)**이다. 모든 관리는 Ansible 기반의 IaC(Infrastructure as Code)로 자동화를 시도하였으며, 노드 간 통신은 WireGuard VPN과 Bastion 기반 ProxyJump SSH를 통한 Zero-Trust 네트워크로 보호된다.</p><figure class="kg-card kg-image-card kg-card-hascaption"><img src="https://yeoun.org/content/images/2026/02/image-13.png" class="kg-image" alt="" loading="lazy" width="638" height="356"><figcaption><span style="white-space: pre-wrap;">현재 서버 아키텍처</span></figcaption></figure><h3 id="11-ansible-%EB%94%94%EB%A0%89%ED%86%A0%EB%A6%AC-%EB%B0%8F-%EC%9D%B8%EB%B2%A4%ED%86%A0%EB%A6%AC-%EA%B5%AC%EC%A1%B0-%EC%84%A4%EA%B3%84">1.1. Ansible 디렉토리 및 인벤토리 구조 설계</h3><p>수동 설정으로 인한 휴먼 에러를 제거하고 멱등성(Idempotency)을 확보하기 위해 Role 기반의 Ansible 아키텍처를 설계했다.</p><ul><li><strong>인벤토리 분리 (inventory.ini):</strong> OCI 노드(arm_hub, vps_entry)와 로컬 노드(n4000, n4200)를 WireGuard 내부 IP 대역(10.0.1.x)으로 그룹화하여 퍼블릭망 노출 없이 안전하게 제어한다.</li></ul><figure class="kg-card kg-code-card"><pre><code class="language-ini">[oci_nodes]
arm_hub    ansible_host=10.0.1.1  ansible_user=ubuntu
vps_entry  ansible_host=10.0.1.9  ansible_user=ubuntu

[home_nodes]
n4000      ansible_host=10.0.1.10 ansible_user=yeoun
n4200      ansible_host=10.0.1.11 ansible_user=yeoun

[all:vars]
ansible_ssh_private_key_file=~/.ssh/id_ed25519
</code></pre><figcaption><p><span style="white-space: pre-wrap;">inventory.ini</span></p></figcaption></figure><ul><li><strong>Role 기반 모듈화:</strong> <code>roles/common</code>에는 모든 서버에 공통 적용될 Timezone, Docker, IP 방화벽, 보안 설정을 정의하고, <code>roles/deploy_services</code>에는 개별 애플리케이션 볼륨을 하나의 데이터 허브로부터 각 노드로 전송하는 로직을 자동화했다.</li></ul><figure class="kg-card kg-code-card"><pre><code class="language-bash">yeoun@DESKTOP-MJUFR8Q:/mnt/c/Users/yeope/yeounhyeok/ansibleWorkspace$ tree -L 4
.
├── ansible.cfg
├── inventory.ini
├── roles
│   ├── common
│   │   ├── handlers
│   │   │   └── main.yml
│   │   └── tasks
│   │       ├── base.yml
│   │       ├── docker.yml
│   │       ├── main.yml
│   │       └── security.yml
│   └── deploy_services
│       └── tasks
│           └── main.yml
├── site.yml
└── tools
    └── cleanup.yml
</code></pre><figcaption><p><span style="white-space: pre-wrap;">ansible 루트 폴더 구조</span></p></figcaption></figure><ul><li><strong>변수 주도 배포 (site.yml):</strong> 각 노드의 스펙과 역할(Data Warehouse, Compute Power, Edge Worker, Gateway)에 맞게 <code>target_services</code> 리스트를 변수로 선언하여, 명령어 한 줄로 13개 이상의 서비스가 <code>deploy_services</code> 플레이북을 통해 각자의 노드에 분산 배치되도록 구현했다.</li></ul><figure class="kg-card kg-code-card"><pre><code class="language-yaml">---
# 1. 🐢 N4000: Data Warehouse (HDD/유선)
- hosts: n4000
  become: yes
  vars:
    target_services:
      - nextcloud
      - immich-app
      - syncthing
      - vaultwarden
      - adguardhome
  roles:
    - common
    - deploy_services

# 2. ⚡ OCI ARM: Compute Power (RAM 24GB)
- hosts: arm_hub
  become: yes
  vars:
    target_services:
      - authentik
      - code-server
      - uptimekuma
      - grafana
  roles:
    - common
    - deploy_services

# 3. 🚀 N4200: Edge Worker (SSD/Web)
- hosts: n4200
  become: yes
  vars:
    target_services:
      - ghost
      - homepage
  roles:
    - common
    - deploy_services

# 4. 🛡️ OCI AMD (vps_entry): Gateway
- hosts: vps_entry
  become: yes
  vars:
    target_services:
      - nginx-proxy-manager
  roles:
    - common
    - deploy_services
</code></pre><figcaption><p><span style="white-space: pre-wrap;">site.yml</span></p></figcaption></figure><h2 id="2-%ED%95%B5%EC%8B%AC-%EB%B0%B0%ED%8F%AC-%EB%A1%9C%EC%A7%81-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EB%8F%99%EA%B8%B0%ED%99%94-%EB%B0%8F-%EB%B3%B4%EC%95%88-%EC%B5%9C%EC%A0%81%ED%99%94">2. 핵심 배포 로직: 데이터 동기화 및 보안 최적화</h2><p>모든 Docker 컨테이너의 데이터는 개별 서버의 <code>~/docker_volumes/{{ 서비스명 }}</code> 경로에 표준화되어 저장된다. 이 구조를 기반으로 데이터 본진(N4000)에서 타 노드로 데이터를 안전하고 빠르게 마이그레이션하기 위한 배포 파이프라인을 구축했다.</p><figure class="kg-card kg-code-card"><pre><code class="language-yaml"># 1. [Security] 맥북에서 N4000으로 프라이빗 키 임시 복사
- name: Temporarily deploy private key to N4000
  copy:
    src: "~/.ssh/id_ed25519"
    dest: "/home/yeoun/.ssh/id_ed25519"
    mode: '0600'
  delegate_to: n4000
  run_once: true

- name: Ensure target docker_volumes directory exists on vps_entry
  file:
    path: "/home/{{ ansible_user }}/docker_volumes"
    state: directory
    mode: '0755'
    owner: "{{ ansible_user }}"
  become: yes # sudo 권한으로 생성

# 2. [Execution] 절대 경로와 sudo를 조합해 동기화
- name: Sync service volumes (Force Root via Sudo)
  command: &gt;
    rsync -avz --delete 
    -e "ssh -i /home/yeoun/.ssh/id_ed25519 -o StrictHostKeyChecking=no" 
    --rsync-path="sudo rsync" 
    /home/yeoun/docker_volumes/{{ item }}/ 
    {{ ansible_user }}@{{ ansible_host }}:/home/{{ ansible_user }}/docker_volumes/{{ item }}
  delegate_to: n4000
  become: yes
  loop: "{{ target_services }}"
  when: inventory_hostname != 'n4000'

# 3. [Security] 마이그레이션 끝났으니 N4000에서 키 삭제
- name: Remove temporary private key from N4000
  file:
    path: "/home/yeoun/.ssh/id_ed25519"
    state: absent
  delegate_to: n4000
  run_once: true
</code></pre><figcaption><p><span style="white-space: pre-wrap;">./roles/deploy_services/tasks/main.yml</span></p></figcaption></figure><h3 id="21-%EA%B6%8C%ED%95%9C-%EB%B6%80%EC%97%AC%EC%99%80-%EC%9C%84%EC%9E%84delegation%EC%9D%84-%ED%86%B5%ED%95%9C-%EB%8D%B0%EC%9D%B4%ED%84%B0-%EB%B6%84%EC%82%B0">2.1. 권한 부여와 위임(Delegation)을 통한 데이터 분산</h3><p>관리자 PC(WSL)에서 각 노드로 데이터를 전송하는 중앙 집중식 방식은 네트워크 병목과 경로 불일치 문제를 야기했다. 이를 해결하기 위해 Ansible의 <code>delegate_to</code> 기능을 활용했다.</p><ul><li><strong>SSH Key 임시 위임:</strong> <code>deploy_services</code> 실행 시 관리자의 프라이빗 키를 N4000에 임시로 복사하고, N4000이 직접 타 노드(n4200, arm_hub 등)로 rsync를 쏘도록 명령을 위임했다.</li><li><strong>보안 파기:</strong> 전송이 완료되면 <code>file: state=absent</code>를 통해 N4000에 남겨진 키를 즉각 삭제하여 보안 무결성을 유지했다.</li></ul><h3 id="22-%EC%9D%B8%ED%94%84%EB%9D%BC-%EC%B5%9C%EC%A0%81%ED%99%94-%EB%B0%8F-%ED%95%98%EB%93%9C%EB%8B%9D-security-hardening">2.2. 인프라 최적화 및 하드닝 (Security Hardening)</h3><ul><li><strong>속도 최적화 및 명령 단순화 (ansible.cfg):</strong> <code>pipelining = True</code> 및 <code>ControlMaster</code> 옵션을 활성화하여 SSH 세션 오버헤드를 줄이고 배포 속도를 대폭 향상시켰다.</li></ul><figure class="kg-card kg-code-card"><pre><code class="language-cfg">[defaults]
inventory = ./inventory.ini
host_key_checking = False

[ssh_connection]
ssh_args = -C -o ControlMaster=auto -o ControlPersist=60s -o ForwardAgent=yes
pipelining = True
</code></pre><figcaption><p><b><strong style="white-space: pre-wrap;">ansible.cfg</strong></b></p></figcaption></figure><figure class="kg-card kg-image-card kg-card-hascaption"><img src="https://yeoun.org/content/images/2026/02/image-12.png" class="kg-image" alt="" loading="lazy" width="733" height="751"><figcaption><span style="white-space: pre-wrap;">원리는 이렇다고 한다</span></figcaption></figure><ul><li><strong>보안 및 로깅 제어:</strong> <code>security.yml</code>을 통해 모든 노드의 Password 및 PAM 인증을 원천 차단했다. 또한 <code>docker.yml</code>에서 컨테이너 로그 드라이버를 <code>json-file</code>로 지정하고 최대 크기를 10MB로 제한하여, 저사양 노드(N4000 등)에서 발생할 수 있는 Disk Full 장애를 사전 예방했다.</li></ul><figure class="kg-card kg-code-card"><pre><code class="language-yml">---
- name: Disable Password Authentication
  lineinfile:
    path: /etc/ssh/sshd_config
    regexp: '^#?PasswordAuthentication'
    line: 'PasswordAuthentication no'
  become: yes

- name: Disable Keyboard Interactive Authentication
  lineinfile:
    path: /etc/ssh/sshd_config
    regexp: '^#?KbdInteractiveAuthentication'
    line: 'KbdInteractiveAuthentication no'
  become: yes

- name: Disable PAM Authentication
  lineinfile:
    path: /etc/ssh/sshd_config
    regexp: '^#?UsePAM'
    line: 'UsePAM no'
  become: yes
  notify: restart ssh
</code></pre><figcaption><p><span style="white-space: pre-wrap;">security.yml</span></p></figcaption></figure><figure class="kg-card kg-code-card"><pre><code>---
- name: Install Dependencies
  apt:
    name: [apt-transport-https, ca-certificates, curl, gnupg, lsb-release]
    state: present
    update_cache: yes

- name: Add Docker GPG Key
  apt_key:
    url: https://download.docker.com/linux/ubuntu/gpg
    state: present

- name: Add Docker Repository
  apt_repository:
    repo: "deb [arch={{ ansible_architecture | replace('x86_64','amd64') | replace('aarch64','arm64') }}] https://download.docker.com/linux/ubuntu {{ ansible_distribution_release }} stable"
    state: present

- name: Install Docker Engine &amp; Compose Plugin
  apt:
    name: [docker-ce, docker-ce-cli, containerd.io, docker-compose-plugin]
    state: present

- name: Set Docker Log Limit (Prevent Disk Full)
  copy:
    dest: /etc/docker/daemon.json
    content: |
      {
        "log-driver": "json-file",
        "log-opts": {
          "max-size": "10m",
          "max-file": "3"
        }
      }
  register: docker_cfg

- name: Restart Docker
  systemd:
    name: docker
    state: restarted
  when: docker_cfg.changed

- name: Add User to Docker Group
  user:
    name: "{{ ansible_user }}"
    groups: docker
    append: yes
</code></pre><figcaption><p><span style="white-space: pre-wrap;">docker.yml</span></p></figcaption></figure><p></p><h2 id="3-trouble-shooting-%EC%97%94%EC%A7%80%EB%8B%88%EC%96%B4%EB%A7%81-%ED%95%9C%EA%B3%84-%EA%B7%B9%EB%B3%B5">3. Trouble Shooting: 엔지니어링 한계 극복</h2><p>이기종 환경에 분산 배포를 진행하며 발생한 OS, 네트워크, 권한 계층의 복합적인 문제들을 논리적으로 추적하고 해결했다.</p><ul><li>🚩 <strong>TS 1. 포트 충돌: Ubuntu DNS와 AdGuard Home의 경합 (Port 53)</strong><ul><li><strong>문제 현상:</strong> N4000 노드에 배포된 AdGuard Home(AGH)이 <code>bind: address already in use</code> 에러를 발생시키며 기동 실패했다.</li><li><strong>원인 분석:</strong> Ubuntu의 기본 DNS 리졸버인 <code>systemd-resolved</code>가 53/UDP 포트를 선점하고 있어, 외부 DNS 서버 역할을 해야 하는 AGH 컨테이너와 포트 경합이 발생했다.</li><li><strong>해결 (IaC 기반 조건부 제어):</strong> Ansible의 <code>base.yml</code> 내에서 <code>when: inventory_hostname == 'n4000'</code> 조건을 부여했다. AGH가 구동되는 N4000 노드만 <code>systemd-resolved</code> 서비스를 강제 중단/비활성화하고, 정적 <code>resolv.conf</code>(127.0.0.1 바라보도록)를 생성했다. 타 노드들은 기존 방식을 유지시켜 시스템 전체의 안정성을 확보했다.</li></ul></li></ul><figure class="kg-card kg-code-card"><pre><code class="language-yml"># --- [분기점] AGH를 돌리는 서버(N4000)만 특별 관리 ---
- name: Disable systemd-resolved only on AGH host (N4000) 
  service:
    name: systemd-resolved
    state: stopped
    enabled: no
  when: inventory_hostname == 'n4000'

- name: Setup static resolv.conf for AGH host # resolved 비활성화로 n4000노드는 DNS를 어디에 물어봐야 할지 모르기 때문
  copy:
    dest: /etc/resolv.conf
    content: |
      nameserver 127.0.0.1
      nameserver 8.8.8.8
    force: yes
  when: inventory_hostname == 'n4000'</code></pre><figcaption><p><span style="white-space: pre-wrap;">base.yml 일부</span></p></figcaption></figure><ul><li>🚩 <strong>TS 2. 경로 정규화 및 권한의 늪 (Path &amp; Permission Mismatch)</strong><ul><li><strong>문제 현상:</strong> 데이터 마이그레이션 후 N4200에서 컨테이너 실행 실패 및 <code>Is a directory</code> 에러(NPM) 발생했다.</li><li><strong>원인 분석:</strong> 서버 간 사용자 이름(ubuntu vs yeoun) 차이로 인해 홈 디렉토리 상대 경로(~)가 다르게 해석되었고, <code>sudo rsync</code>로 데이터를 넘기면서 소유권이 Root(uid=0)로 변경되어 일반 유저 권한(uid=1000)으로 구동되는 컨테이너가 데이터에 접근하지 못했다.</li><li><strong>해결:</strong> Ansible 코드 내의 모든 상대 경로를 <code>/home/{{ ansible_user }}/</code> 형태의 절대 경로 변수로 정규화하여 환경 의존성을 제거했다. 마이그레이션 후 <code>chown -R 1000:1000</code>을 강제하여 권한 충돌을 말끔히 해결했다. 잘못 생성된 NPM 디렉토리는 삭제 후 올바른 마운트 경로로 재배포했다.</li></ul></li><li>🚩 <strong>TS 3. The Ghost in the Config: Split DNS와 SSO 연동 장애</strong><ul><li><strong>문제 현상:</strong> Immich와 Authentik 간의 OIDC(SSO) 연동 시 <code>fetch failed</code> 및 <code>Connection Refused</code> 에러 지속 발생했다.</li><li><strong>원인 분석:</strong> 과거 수동으로 구축했던 Docker Compose 파일 내 <code>extra_hosts</code>에 박혀있던 낡은 로컬 IP(192.168.45.xx)가 원인이었다. VPN Mesh로 서버를 묶기 이전에 하드코딩된 설정이 중앙 DNS(AdGuard)의 Rewrites 정책을 무시하면서 트래픽이 올바른 라우팅 경로를 타지 못하고 엉뚱한 내부 IP를 맴돌았다.</li><li><strong>해결 (Architect's Perspective):</strong> "예외를 두지 않는다"는 원칙하에 모든 Compose 파일에서 <code>extra_hosts</code>를 과감히 삭제했다. 내부 트래픽이 반드시 10.0.1.9 (NPM Gateway)를 거쳐 인증 서버로 흐르도록 **단일 DNS 제어권(Single Point of Control)**을 확립하여 네트워크 레이어의 혼선을 종식시켰다.</li></ul></li></ul><h2 id="4-%EC%84%B1%EA%B3%BC-%EB%B0%8F-%EA%B3%A0%EC%B0%B0-outcome-insight">4. 성과 및 고찰 (Outcome &amp; Insight)</h2><figure class="kg-card kg-image-card kg-card-hascaption"><img src="https://yeoun.org/content/images/2026/02/image-14.png" class="kg-image" alt="" loading="lazy" width="2000" height="1074"><figcaption><span style="white-space: pre-wrap;">n4000 노드 glances</span></figcaption></figure><figure class="kg-card kg-image-card"><img src="https://yeoun.org/content/images/2026/02/image-15.png" class="kg-image" alt="" loading="lazy" width="2000" height="1055"></figure><figure class="kg-card kg-image-card kg-card-hascaption"><img src="https://yeoun.org/content/images/2026/02/image-16.png" class="kg-image" alt="" loading="lazy" width="1030" height="308"><figcaption><span style="white-space: pre-wrap;">n4200, 그래도 램 부하를 어느정도 나눠 가진 모습이다</span></figcaption></figure><ul><li>📈 <strong>최종 성과</strong><ul><li><strong>약 3일간 반복적인 재배포 및 장애 수정 사이클을 통해<br>구조 안정화를 수행하였다.</strong></li><li><strong>4대 서버 환경의 완전한 표준화:</strong> 수동 개입 없이 <code>ansible-playbook site.yml</code> 명령 단 한 줄로 Nginx Proxy Manager, Ghost, Homepage, 백엔드 서비스들이 각자의 노드에서 완벽히 구동되는 상태를 달성했다.  </li><li>Stateless 아키텍처의 필요성을 느끼고 아직 전부 옮기지는 않았지만 위와 같이 램 부하를 나눠 가질 수 있다는 것을 확인할 수 있었다.</li><li><strong>Zero-Trust 라우팅 안정화:</strong> OCI 클라우드에서 시작된 트래픽이 WireGuard 터널을 타고 로컬 엣지 노드(N4200)의 서비스로 매끄럽게 연결되는 하이브리드 클라우드 네트워크 아키텍처를 검증했다. </li></ul></li><li>💡 <strong>기술적 통찰 (Lessons Learned)</strong></li><li><strong>상대 경로의 위험성:</strong> IaC 환경에서는 실행 주체에 따라 컨텍스트가 변할 수 있음을 깨닫고, 모든 변수와 경로는 절대적 기준으로 정규화해야 함을 체득했다.</li><li><strong>Stateless 아키텍처의 중요성⭐⭐⭐:</strong> 데이터와 설정이 결합된 상태에서 시스템을 마이그레이션하는 것의 위험성을 확인했다. <ul><li>만약 서비스 중인 노드가 죽으면 그대로 끝이다. 향후 오케스트레이션 등의 고급 기술을 사용하여 복구한다고 해도 최신 DB는 해당 노드에만 있었기 때문에 최신상태로 복구가 불가능하다.</li><li>또한 Ansible 플레이북을 잘못 실행하여 이전 버전 DB를 가진 노드에서최신 DB를 가진 노드로 deploy_services 하게 될 경우 데이터 충돌이 일어나거나 이전버전으로 롤백되는 위험성이 존재했다.</li></ul></li><li>Ansible이 기본 제공하는 synchronize 사용 : <ul><li>초기에는 이기종 하드웨어 간 전체 데이터 표준화와 볼륨 배치가 최우선이었다. 따라서 <strong>rsync</strong>를 활용해 데이터 정합성을 직접 제어하며 인프라를 표준화했다.</li><li>하지만 운영 결과, 이러한 <strong>Stateful</strong> 배포 방식은 노드 장애 시 복구 타임(RTO)을 늦추고 데이터 충돌 위험을 내포함을 확인했다. 이에 다음 단계에서는 데이터를 외부 스토리지로 격리하고 실행 환경만 관리하는 <strong>Stateless 아키텍처</strong>로 전환하여 클러스터의 탄력성(Resiliency)을 확보할 계획이다.</li></ul></li></ul><h2 id="5-%ED%96%A5%ED%9B%84-%EA%B3%BC%EC%A0%9C-cicd-%EC%A0%84%ED%99%98">5. 향후 과제: CI/CD 전환</h2><p>현재의 성공적인 자동화에도 불구하고, 강력한 동기화 도구를 이용한 중앙 배포 방식은 실시간 운영 데이터의 덮어쓰기 및 충돌 위험성을 내포하고 있다. 이를 해결하기 위해 다음 단계로 아키텍처를 고도화할 계획이다.</p><ul><li><strong>Storage &amp; Compute 분리:</strong> 서비스 구동에 필요한 'compose.yml'은 Ansible/Git으로 배포하고, 서비스가 생성하는 'Data(DB)'는 독립된 네트워크 스토리지(NFS)에 격리하고 각 노드로 연결하여 데이터 무결성을 보장하겠다.</li><li><strong>GitOps 파이프라인(CI/CD) 구축:</strong> 수동 명령어 실행 방식에서 벗어나 GitHub에 인프라 코드를 Push하면 자동으로 배포되는 파이프라인을 도입하겠다.</li></ul>


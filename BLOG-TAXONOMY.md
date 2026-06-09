# yeoun.org taxonomy convention

Canonical blog app: Fuwari on `yeoun.org`.

Fuwari has one `category` string and many `tags`, so the blog uses this rule:

- `category`: `대분류 / 중분류`
- `tags`: concrete tools, projects, algorithms, and context

The category tree should read like a portfolio map, not a complete CMDB/tool inventory. Tools such as Terraform, Ansible, WireGuard, Docker, CUDA, YOLO, etc. usually belong in tags unless a whole series deserves its own category.

## Current category tree

```text
DevOps
├─ Infrastructure
├─ Automation
├─ Observability
├─ Kubernetes
└─ Troubleshooting

Architecture
├─ Homelab
├─ Hybrid Cloud
├─ Network
├─ Security / Access
└─ Troubleshooting

AI Platform
├─ Agents
├─ Open Source
├─ RAG
├─ Multi-agent
└─ Troubleshooting

MLOps
├─ Model Serving
├─ GPU Workspace
├─ Evaluation
└─ Troubleshooting

Research
├─ Vision AI
├─ 3D Gaussian Splatting
├─ Physical AI / VLA
├─ Computer Vision
└─ Troubleshooting

Software Engineering
├─ Backend
├─ API
├─ Languages
└─ Troubleshooting

Algorithms
├─ Problem Solving
├─ Dynamic Programming
├─ Graph
└─ BOJ

Mathematics
└─ Statistics
```

## Category intent

### DevOps

Operational engineering: infrastructure as code, automation, monitoring, incident response, and development/runtime environment problems.

- `DevOps / Infrastructure`: cloud resources, containers, networked runtime, service foundations
- `DevOps / Automation`: Ansible, CI/CD, repeatable provisioning/deployment
- `DevOps / Observability`: monitoring, alerting, logs, health checks, auto-diagnosis
- `DevOps / Kubernetes`: k3s/Kubernetes, GitOps, cluster operations, ingress, and pod-level service operations
- `DevOps / Troubleshooting`: practical failure analysis in infra/dev environments

### Architecture

System-level shape and tradeoffs: homelab topology, hybrid cloud, network/security boundaries, and long-lived service architecture.

- `Architecture / Homelab`: home server/service topology and node roles
- `Architecture / Troubleshooting`: architectural failures where the fix is boundary/topology redesign

### AI Platform

Agent runtimes, provider integrations, RAG/campus agents, and open-source AI platform work.

- `AI Platform / Agents`: personal/runtime agents and tool-using systems
- `AI Platform / Open Source`: upstream or OSS contributions related to AI platform/runtime/provider layers
- `AI Platform / Troubleshooting`: provider/runtime/agent failures and fixes

### MLOps

Model serving, GPU development workspaces, evaluation, and reproducible ML runtime operations.

- `MLOps / Model Serving`: inference servers, API serving, local/remote model runtime
- `MLOps / GPU Workspace`: CUDA/PyTorch/LLM dev environments when the main lesson is ML runtime setup
- `MLOps / Troubleshooting`: model/runtime/GPU-specific operational failures

### Research

Research notes and implementation records for Vision AI, 3DGS, Physical AI/VLA, and computer vision experiments.

- `Research / Vision AI`: general vision research and experiments
- `Research / 3D Gaussian Splatting`: 3DGS-specific work
- `Research / Physical AI / VLA`: VLA/robotics/scene perception line
- `Research / Troubleshooting`: research-code, data, camera, experiment consistency failures

### Software Engineering

Backend/API/language-level engineering that is not primarily infra or ML runtime.

- `Software Engineering / Backend`: backend services and application architecture
- `Software Engineering / Troubleshooting`: language/framework/API debugging records

### Algorithms

Problem solving and algorithm study.

- `Algorithms / Problem Solving`: BOJ and algorithm notes
- tags split topics such as `Dynamic Programming`, `Graph`, `Shortest Path`, `C++`

### Mathematics

Mathematical/statistical reasoning posts where the main value is the model, formula, or interpretation method rather than a software build.

- `Mathematics / Statistics`: probability, entropy, distributions, statistical interpretation, and data reasoning posts.

## Current post mapping

```text
DevOps / Infrastructure
- MOA CREW IaC 레포를 만들며: Terraform과 Ansible은 왜 필요한가
- MOA dev 인프라 CI/CD와 인증 흐름 정리

DevOps / Automation
- [Ansible] Hybrid Cloud 인프라 자동화 및 분산 배포

DevOps / Observability
- Hermes Agent 기반 홈서버 자동진단·복구 파이프라인 만들기

DevOps / Troubleshooting
- 개발 컨테이너는 공유하되, 세션은 공유하지 말자

Architecture / Homelab
- [Architecture] 윈도우 전용 노트북을 하이브리드 클라우드 워커로
- [Architecture] 마인크래프트 서버 구축 변천사

AI Platform / Open Source
- HKUDS NanoBot PR #4018: Codex stream idle timeout 설정을 실제로 반영하게 만든 이야기

Algorithms / Problem Solving
- BOJ11049 : 행렬 곱셈 순서
- 최단거리 알고리즘 정리 (Legacy)
```

## Future rule of thumb

If a post is about building a system, place it under the system domain. If it is about diagnosing a failure, place it under that domain's `Troubleshooting` category.

Examples:

- Docker/Nginx/SSH/VS Code Remote failure → `DevOps / Troubleshooting`
- WireGuard/Tailscale/Cloudflare topology failure → `Architecture / Troubleshooting`
- LLM provider timeout/streaming failure → `AI Platform / Troubleshooting`
- CUDA/PyTorch/driver/model-serving failure → `MLOps / Troubleshooting`
- 3DGS camera transform/data consistency failure → `Research / Troubleshooting`
- Go/API/database bug → `Software Engineering / Troubleshooting`

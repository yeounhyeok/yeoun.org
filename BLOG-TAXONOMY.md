# yeoun.org taxonomy convention

Canonical blog app: Fuwari on `yeoun.org`.

Fuwari supports one `category` string per post and many `tags`. To model 대-중-소 taxonomy:

- `category`: 대분류 / 중분류
- `tags`: 소분류 + tools + project/context

## Source basis

This taxonomy is based on:

- Obsidian homelab notes: DB Hub/SSoT, Tailscale troubleshooting, OCI migration, Uptime Kuma → Hermes auto-diagnosis pipeline
- Current SSH/Tailscale runtime map: `arm`, `n4000`, `n4200`, `dev-ec2`, `rag`, `study`, `pc`, `lab`, `gpu`; Tailscale peers include `arm`, `n4200`, `n4000`, desktop/mobile/tablet clients, and `ip-10-0-0-235`
- GitHub repositories: `Yeoun-Homelab-IaC`, `3DGS-Integration-Sandbox`, `PAI-Vision`, `hf-local-model-lab`, `vla-mini-project`, `langgraph-novel-lab`, Hansung automation/RAG repos, `BOJWorkspace`, NanoBot/Immich forks
- User profile roadmap: AI Platform Engineer / MLOps Engineer / System Architect; IaC → observability → Go/backend → MLOps

## Category tree

```text
DevOps / Infrastructure
├─ IaC
│  ├─ Terraform
│  ├─ Ansible
│  ├─ Ansible Vault
│  ├─ Jinja templates
│  ├─ Inventory design
│  ├─ Idempotent provisioning
│  └─ State / secrets management
├─ Cloud Infrastructure
│  ├─ OCI ARM
│  ├─ AWS EC2
│  ├─ VCN / Subnet / Security List
│  ├─ IAM
│  ├─ Object Storage / S3
│  ├─ RDS
│  └─ Cross-region boot volume recovery
├─ Runtime / Containers
│  ├─ Docker
│  ├─ Docker Compose V2
│  ├─ Nginx / nginx:alpine
│  ├─ Nginx Proxy Manager
│  ├─ Cloudflared container
│  ├─ Dev Container
│  └─ CUDA / PyTorch container
├─ Network
│  ├─ Tailscale
│  ├─ MagicDNS / Quad100
│  ├─ WireGuard
│  ├─ Split DNS
│  ├─ AdGuard Home DNS rewrite
│  ├─ Cloudflare Tunnel
│  ├─ Cloudflare DNS / Proxy
│  ├─ FRP
│  ├─ NFS
│  └─ SSH bastion / host aliases
└─ Homelab Node Roles
   ├─ arm / OCI ARM: agent, monitoring, DB hub, identity
   ├─ n4000: data hub, NFS, proxy, Cloudflare Tunnel, media
   ├─ n4200: edge/app node, blog, home apps
   ├─ dev-ec2: staging/development server
   ├─ rag / study / lab / gpu: AI experiment nodes
   └─ pc / desktop clients: local compute and Windows GPU workflow

DevOps / Observability
├─ Monitoring
│  ├─ Uptime Kuma
│  ├─ Prometheus
│  ├─ Grafana
│  ├─ Loki
│  ├─ Promtail
│  └─ Healthcheck design
├─ Incident Response
│  ├─ Webhook alerting
│  ├─ Hermes auto-diagnosis
│  ├─ SSH-based diagnosis
│  ├─ Docker logs / events
│  ├─ DNS / HTTP probe
│  ├─ Discord reporting
│  └─ Recovery log in Obsidian
└─ Reliability Engineering
   ├─ OOM debugging
   ├─ Container healthcheck
   ├─ Cloud region migration
   ├─ External reachability test
   ├─ Backup / restore drill
   └─ Postmortem writing

DevOps / Automation
├─ Configuration Management
│  ├─ Ansible roles
│  ├─ `site.yml`
│  ├─ Host-specific variables
│  ├─ Docker install automation
│  ├─ WireGuard automation
│  ├─ Tailscale join automation
│  └─ NFS mount automation
├─ Deployment Automation
│  ├─ Docker Compose deployment
│  ├─ rsync volume synchronization
│  ├─ GitHub Actions
│  ├─ CI/CD staging
│  ├─ Static blog deploy
│  └─ Service start/stop playbooks
└─ School / Workflow Automation
   ├─ Hansung e-class attendance scripts
   ├─ Hansung info crawler
   ├─ Course recommendation
   ├─ Schedule conflict checking
   ├─ OpenClaw/Hermes skills
   └─ Calendar / Notion / Obsidian integration

Architecture / Homelab
├─ Hybrid Cloud Architecture
│  ├─ OCI + local nodes
│  ├─ Cloudflare Tunnel + local NPM
│  ├─ Tailscale management plane
│  ├─ Public path vs private path separation
│  ├─ Edge/app/data role separation
│  └─ Failure-domain split
├─ DB Hub / SSoT
│  ├─ PostgreSQL 16
│  ├─ PostgreSQL for Immich
│  ├─ MariaDB 11
│  ├─ Redis
│  ├─ RabbitMQ
│  ├─ Logical DB/user isolation
│  ├─ Backup / migration
│  └─ DB sprawl reduction
├─ Self-hosted Services
│  ├─ Nextcloud
│  ├─ Immich
│  ├─ Navidrome
│  ├─ Vaultwarden
│  ├─ Syncthing
│  ├─ Authentik
│  ├─ OnlyOffice
│  ├─ Home Assistant / Matter
│  ├─ Homepage
│  ├─ Quartz / Obsidian publish
│  ├─ Minecraft server
│  └─ Transmission + Gluetun
└─ Security / Access Control
   ├─ Authentik SSO
   ├─ SSH key management
   ├─ UFW / Security List
   ├─ Tailscale ACL-style boundary
   ├─ Secret redaction
   ├─ Ansible Vault
   └─ Least-privilege service accounts

AI Platform / Agents
├─ Personal Agent Runtime
│  ├─ Hermes Agent
│  ├─ Gateway webhook
│  ├─ Discord DM interface
│  ├─ Cron jobs
│  ├─ Tool calling
│  ├─ Skills / procedural memory
│  ├─ Obsidian integration
│  ├─ GitHub integration
│  └─ SSH / terminal integration
├─ Open-source Agents
│  ├─ OpenClaw ecosystem
│  ├─ HKUDS NanoBot
│  ├─ Codex provider
│  ├─ Stream idle timeout
│  ├─ Provider stability
│  ├─ OpenAI-compatible endpoints
│  └─ Multi-provider runtime
├─ RAG / Campus Agent
│  ├─ Hansung AI Agent
│  ├─ Retrieval-Augmented Generation
│  ├─ OCR / document understanding
│  ├─ Multimodal upload flow
│  ├─ Memory / conversation context
│  ├─ Tools / external API actions
│  ├─ React / Vite / TypeScript frontend
│  └─ Axios / Nginx / staging deploy
└─ Multi-agent Workflows
   ├─ LangGraph
   ├─ State-based routing
   ├─ Manager / director / character / writer / auditor graph
   ├─ Agent memory
   ├─ Quality audit loop
   └─ Korean generation workflow

MLOps / Model Serving
├─ Local LLM Lab
│  ├─ Hugging Face Transformers
│  ├─ PyTorch
│  ├─ CUDA
│  ├─ QLoRA
│  ├─ Quantization
│  ├─ llama.cpp
│  ├─ Gradio
│  ├─ FastAPI inference server
│  └─ Remote inference client
├─ GPU Development Environment
│  ├─ CUDA 13 dev container
│  ├─ Miniconda
│  ├─ Dockerfile
│  ├─ Compose-managed GPU runtime
│  ├─ NVIDIA driver / CUDA wheel compatibility
│  └─ Reproducible ML workspace
└─ Evaluation / Operations
   ├─ Smoke tests
   ├─ Model download/cache
   ├─ Benchmarking
   ├─ Prompt comparison
   ├─ CPU vs GPU fallback
   └─ API serving boundary

Research / Vision AI
├─ 3D Gaussian Splatting
│  ├─ 3DGS
│  ├─ ObjectMorpher
│  ├─ SuperGaussian
│  ├─ VistaDream
│  ├─ PixelHacker
│  ├─ ARAP deformation
│  ├─ Gaussian rendering
│  ├─ OpenCV / OpenGL camera convention
│  ├─ `transforms.json`
│  ├─ Pseudo-GT / refinement signals
│  └─ Experiment adapter layer
├─ Physical AI / VLA
│  ├─ Vision-Language-Action pipeline
│  ├─ PAI-Vision
│  ├─ LeRobot
│  ├─ YOLO / YOLO11 segmentation
│  ├─ USB camera capture
│  ├─ ZMQ frame publishing
│  ├─ WebSocket scene stream
│  ├─ HTTP scene API
│  ├─ Scene JSON schema
│  ├─ Multi-camera config
│  └─ Input distribution consistency
├─ Computer Vision
│  ├─ OpenCV
│  ├─ HaarCascade
│  ├─ Face recognition
│  ├─ Object detection
│  ├─ Segmentation
│  ├─ Tracking
│  └─ Camera calibration / transforms
└─ AI Math / Experimentation
   ├─ Jupyter Notebook
   ├─ Linear algebra
   ├─ Optimization
   ├─ Multimodal classification
   ├─ Action prediction
   └─ Reproducible experiment notes

Software Engineering / Backend
├─ Languages
│  ├─ Python
│  ├─ Go
│  ├─ C++
│  ├─ TypeScript
│  ├─ Shell
│  ├─ SQL
│  └─ Jinja / YAML / HCL
├─ Backend / API
│  ├─ FastAPI
│  ├─ Uvicorn
│  ├─ WebSocket
│  ├─ ZMQ
│  ├─ REST API
│  ├─ OpenAI-compatible API
│  └─ Background workers
├─ Frontend
│  ├─ React
│  ├─ Vite
│  ├─ TypeScript
│  ├─ CSS
│  ├─ Biome
│  ├─ Netlify config
│  └─ Nginx static serving
└─ Data / Storage
   ├─ PostgreSQL
   ├─ MariaDB
   ├─ SQLite
   ├─ Redis
   ├─ Object storage
   ├─ NFS
   └─ Syncthing

Open Source / Contributions
├─ Upstream PR
│  ├─ HKUDS NanoBot PR #4018
│  ├─ Provider bugfix
│  ├─ Runtime configuration
│  ├─ Stream timeout consistency
│  └─ Conservative contribution writeup
├─ Fork Analysis
│  ├─ NanoBot fork
│  ├─ Immich fork
│  ├─ Upstream tracking
│  ├─ Diff reading
│  └─ Patch validation
└─ Portfolio Evidence
   ├─ PR metadata
   ├─ GitHub API verification
   ├─ Obsidian contribution note
   ├─ Blog post
   └─ External reference caveat

Algorithms / Problem Solving
├─ Dynamic Programming
│  ├─ Matrix chain multiplication
│  ├─ State definition
│  ├─ Transition design
│  └─ Complexity analysis
├─ Graph
│  ├─ BFS
│  ├─ Dijkstra
│  ├─ Bellman-Ford
│  ├─ Floyd-Warshall
│  └─ Shortest path comparison
└─ Competitive Programming Environment
   ├─ BOJ
   ├─ C++17/20
   ├─ Dev Container
   ├─ Python helper scripts
   └─ Problem-note publishing
```

## Current-post classification

- `moa-crew-iac-terraform-ansible`: `DevOps / Infrastructure`; tags: `IaC`, `Terraform`, `Ansible`, `AWS`, `IAM`, `RDS`, `S3`, `MOA-CREW`
- `uptime-kuma-hermes-auto-recovery-pipeline`: `DevOps / Observability`; tags: `Homelab`, `Uptime Kuma`, `Hermes Agent`, `Auto Recovery`, `Docker`, `Webhook`, `SSH`, `Discord`, `Obsidian`
- `ansible-hybrid-cloud-inpeura-jadonghwa-mic-bunsan-baepo`: `DevOps / Automation`; tags: `Ansible`, `Hybrid Cloud`, `IaC`, `Distributed Deployment`, `WireGuard`, `Tailscale`, `NFS`, `Docker Compose`
- `hkuds-nanobot-pr-4018-codex-stream-idle-timeout-fix`: `Open Source / Contributions`; tags: `Open Source`, `AI Agent`, `NanoBot`, `Codex`, `Provider Stability`, `Stream Timeout`, `MLOps`
- `infra-windou...wireguard...`: `Architecture / Homelab`; tags: `Hybrid Cloud`, `OCI`, `WireGuard`, `Network Architecture`, `Worker Node`, `Tailscale`, `Split DNS`
- `p028f9q3hjp9823`: `Architecture / Homelab`; tags: `Game Server`, `Minecraft`, `OCI`, `Always-on Server`, `Docker`, `Backup`
- `boj11049-haengryeol-gobsem-sunseo`: `Algorithms / Problem Solving`; tags: `BOJ`, `Dynamic Programming`, `Matrix Chain Multiplication`, `C++`
- `coedangeori-algorijeum-jeongri-le`: `Algorithms / Problem Solving`; tags: `Graph`, `Shortest Path`, `BFS`, `Dijkstra`, `Bellman-Ford`, `Floyd-Warshall`, `C++`

## Candidate future posts by stack

- `Architecture / Homelab`: DB Hub SSoT, Tailscale DNS rewrite, Cloudflare Tunnel migration, OCI cross-region recovery
- `DevOps / Observability`: Loki OOM case, Uptime Kuma monitor design, external reachability testing
- `AI Platform / Agents`: Hermes runtime architecture, webhook tool-calling boundary, NanoBot provider reliability
- `MLOps / Model Serving`: CUDA dev container, local Hugging Face inference server, QLoRA notebook, llama.cpp/quantization path
- `Research / Vision AI`: 3DGS integration sandbox, PAI-Vision YOLO/ZMQ/WebSocket architecture, VLA mini project
- `Software Engineering / Backend`: FastAPI/WebSocket/ZMQ scene API, React/Vite Hansung RAG frontend, Hansung automation scripts

## Naming rules

- Prefer stable category names over one-off project names.
- Put project names in tags, not categories, unless the project becomes a long-running series.
- Keep `category` in English for URL/UI consistency; Korean explanations belong in post body.
- Use title case for tools: `Tailscale`, `WireGuard`, `PostgreSQL`, `FastAPI`, `LangGraph`.
- For security-sensitive infra details, prefer conceptual tags over exact private IPs or secrets.

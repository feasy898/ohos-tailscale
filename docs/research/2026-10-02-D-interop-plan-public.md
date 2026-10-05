# 2026-10-02 子线 D：headscale 隔离互操作回归方案（对外版）

> 原始研究纪实在 `2026-10-02-D-interop-plan.md`（仅仓库内含内部主机/凭据/CLI 旗标现场记录的版本）。
> 本文件为公开版本，按 `PUBLIC-SCRUB-NOTE.md` 口径做了脱敏：主机名/IP/ssh 别名/token 全部替换为占位符，仅保留方法学与命令骨架。

## 1. 任务三问（公开口径）

| # | 问题 | 公开结论 |
|---|------|---------|
| 1 | 本机有无 docker | 本机无；如需容器化执行，改走远端 docker 主机 |
| 2 | GitHub Releases 直连下载 headscale windows amd64 二进制 | 上游从未发布 windows 构建，且 `github.com` 在本机直连被墙；`api.github.com` 可达，必须走 API 资产路由 + `Accept: application/octet-stream`；仅 linux_amd64 可下 |
| 3 | `ssh root@<GPU-TAILNET-IP>`（BatchMode）可达性 | TCP/sshd 可达，root 认证被拒；用既有 `dev-env-with-gpu` ssh 别名（`anuser@<GPU-PUBLIC-IP>` + 本机私钥）完全可用 |

## 2. 红线（R1–R6，对照原文件 §5）

- **R1** 只用隔离实例：headscale 监听只绑 `127.0.0.1`；禁 `--network host`（避免与宿主机既有 tailnet 共址）。
- **R2** 绝不碰生产 tailnet：一切 HTTP 只对 `http://127.0.0.1:8080`；不在远端执行任何改状态的 `tailscale` CLI。
- **R3** 临时凭据用后即弃：注册用 preauthkey、nodekey/mkey 公钥前缀可保留，私钥/私钥文件不得入仓。
- **R4** 证据只入哈希与命令输出摘要：noise/derp/sqlite 私钥文件永不进仓，只留 `sha256sum state/*` 哈希行。
- **R5** 端口闭环：headscale/embedded DERP/STUN 都绑 `127.0.0.1`；映射到容器/远端用 SSH `-L` 转发即可。
- **R6** ssh 仅走既有别名 `dev-env-with-gpu` 的只读运维；不尝试改远端 authorized_keys、不口令尝试。

## 3. 首选方案（公开版骨架）

**P0：远端 docker 隔离实例全闭环**

命令序列骨架（实际地址与私钥路径按本机替换）：

```bash
# 1. 拉 headscale 镜像（远端 docker 主机上）
ssh dev-env-with-gpu "docker pull headscale/headscale:<VERSION>"

# 2. 起隔离实例：回环绑定 + 临时卷（用后即弃）
ssh dev-env-with-gpu "docker run -d --name hs-isolated --rm \
  -p 127.0.0.1:8080:8080 \
  -v /tmp/hs-isolated:/var/lib/headscale \
  -e HEADSCALE_LISTEN_ADDR=127.0.0.1:8080 \
  headscale/headscale:<VERSION> serve"

# 3. 端口转发回本机
ssh -L 127.0.0.1:18080:127.0.0.1:8080 -fN dev-env-with-gpu

# 4. 跑互操作回归（interop/register.node.ts + interop/h2c.node.ts + interop/derp.node.ts）
cd /d/new-workspace/ohos-tailscale
HS=http://127.0.0.1:18080 npm run --silent interop:regress

# 5. 证据归档到 evidence/interop-<date>/（只留命令输出 + 哈希行，不留私钥）
mkdir -p evidence/interop-20261002
sha256sum state/* > evidence/interop-20261002/state.sha256
HS=http://127.0.0.1:18080 npm run --silent interop:regress \
  | tee evidence/interop-20261002/regress.log

# 6. 收尾：用后即弃
ssh dev-env-with-gpu "docker stop hs-isolated"
```

判定输出必须包含两条字符串（大小写敏感）：

- `INTEROP PASS`——控制面注册/MapRequest/heartbeat 全链
- `DERP INTEROP PASS`——embedded DERP 的 HTTP mesh upgrade 与 ping/pong

## 4. 降级链（按 §1 三问的可达性梯次降级）

| 优先级 | 路径 | 失败则降级到 |
|--------|------|--------------|
| P0 | 远端 docker 隔离实例 + SSH 端口转发 | P1 |
| P1 | 本机下载 headscale linux_amd64 + 临时端口起进程 | P2 |
| P2 | 纯脚本骨架交付 + 书面降级说明（ran=false，交付可执行脚本与红线清单） | — |

## 5. 与本仓 gate 的衔接

本子线的产物只有**两件**对 G0 五门有外溢影响：

1. `interop/regress.mjs`（一键回归入口）——写完后跑 `npm run interop:regress` 应输出 `INTEROP PASS` 与 `DERP INTEROP PASS`；失败不影响 G0（G0 五门只覆盖 `npm test / typecheck / test:bridge / validate:shell / D4-P4`），但推到 GitHub 前必须真跑过一次并把证据目录 commit。
2. `evidence/interop-<date>/` ——只含命令输出、`*.sha256`、README.md（红线说明）；不出现私钥/真实主机/IP/token。

## 6. 复跑指引（环境就绪后）

```bash
# 验证远端 docker 可用
ssh dev-env-with-gpu "docker version"

# 按 §3 跑一遍；断言两条 PASS 字符串；归档到新 evidence 目录
mkdir -p evidence/interop-<YYYYMMDD>
# ... 跑 ...
# 提交：git add evidence/interop-<YYYYMMDD> && git commit -m "interop: <date> 隔离互操作回归"
```

## 7. 未决项

- 真实执行需远端 docker 主机的 SSH 别名 + 本机私钥，不在本仓脱敏范围内；执行者在跑前自检 `~/.ssh/config` 的 `Host dev-env-with-gpu` 是否配置。
- 本机若有 docker，可跳过 §3 第 1 步的 ssh 包装，把命令就地跑（仍然按 R1/R2 闭环）。

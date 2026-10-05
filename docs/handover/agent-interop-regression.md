# 接手任务：在带 docker 的环境跑 headscale 隔离互操作回归

## 你要做什么

子线 D 的真实互操作回归脚本骨架齐了（`docs/research/2026-10-02-D-interop-plan-public.md`），但当前 `ran=false`。你的任务是**在带 docker 的环境跑一次**，证据落 `evidence/interop-<日期>/`，输出 `INTEROP PASS` 与 `DERP INTEROP PASS` 两条字符串。

## 前置（一次性 owner 准备）

1. 远端 docker 主机可达（首选 SSH 别名 `dev-env-with-gpu`，GPU 机已装 Docker 29.8.1）；
2. 或：本机有 docker（更省一步 ssh 包装）；
3. `~/.ssh/config` 已配 `dev-env-with-gpu`（默认映射 anuser@<GPU-PUBLIC-IP> + `~/.ssh/wsl_key`，见 `~/.ssh/config`）。

## 执行（按 P0 首选方案走）

按 `docs/research/2026-10-02-D-interop-plan-public.md §3` 命令骨架：

```bash
# 1. 拉镜像（远端 docker 主机上）
ssh dev-env-with-gpu "docker pull headscale/headscale:<VERSION>"

# 2. 起隔离实例：回环绑定 + 临时卷（用后即弃）
ssh dev-env-with-gpu "docker run -d --name hs-isolated --rm \
  -p 127.0.0.1:8080:8080 \
  -v /tmp/hs-isolated:/var/lib/headscale \
  -e HEADSCALE_LISTEN_ADDR=127.0.0.1:8080 \
  headscale/headscale:<VERSION> serve"

# 3. 端口转发回本机
ssh -L 127.0.0.1:18080:127.0.0.1:8080 -fN dev-env-with-gpu

# 4. 跑互操作回归
cd <repo>
HS=http://127.0.0.1:18080 npm run --silent interop:regress

# 5. 证据归档（只留命令输出 + 哈希行，不留私钥）
mkdir -p evidence/interop-<YYYYMMDD>
sha256sum state/* > evidence/interop-<YYYYMMDD>/state.sha256
HS=http://127.0.0.1:18080 npm run --silent interop:regress \
  | tee evidence/interop-<YYYYMMDD>/regress.log

# 6. 收尾：用后即弃
ssh dev-env-with-gpu "docker stop hs-isolated"
```

## 验收

`evidence/interop-<日期>/regress.log` 必须含两条字符串（大小写敏感）：

- `INTEROP PASS` —— 控制面注册/MapRequest/heartbeat 全链
- `DERP INTEROP PASS` —— embedded DERP 的 HTTP mesh upgrade 与 ping/pong

任一缺失即视为失败。**不要重试 patch 凑 PASS**——这违反互操作基线可信度原则。

## 红线（不可放宽，违反即作废）

- **headscale 监听只绑 127.0.0.1**；禁 `--network host`（避免与宿主机既有 tailnet 共址）；
- **一切 HTTP 只对 `http://127.0.0.1:8080`**；不发起任何对外域名/100.64.0.0/10 注册请求；
- **preauthkey 用后即弃**，不入仓；只留 `sha256sum state/*` 哈希行；
- **ssh 仅走 `dev-env-with-gpu` 别名**；不尝试改远端 `authorized_keys`、不口令尝试；
- **不在远端执行任何改状态的 `tailscale` CLI**——只允许只读运维（起/停自建隔离容器）；
- **私钥永不进 evidence/**——只留公钥前缀 + 哈希；
- 跑前自检 `~/.ssh/config` 的 `Host dev-env-with-gpu` 是否配置。

## 降级链

| 优先级 | 路径 | 失败则降级到 |
|--------|------|--------------|
| P0 | 远端 docker 隔离实例 + SSH 端口转发 | P1 |
| P1 | 本机下载 headscale linux_amd64 + 临时端口起进程 | P2 |
| P2 | 纯脚本骨架交付 + 书面降级说明（ran=false，交付可执行脚本与红线清单） | — |

注意：headscale **windows amd64 二进制从未发布**（GitHub Releases 0 命中），跳过 windows 直跑方案。

## 完成后必做

1. `evidence/interop-<日期>/README.md`（简短说明：本批的环境、时间、执行者 sha、两条 PASS 字符串的位置）；
2. 在 `docs/research/2026-10-02-D-interop-plan-public.md` 末尾追加一行 `## 历史执行记录`，写日期 + PASS/FAIL；
3. 在 `DELIVERY_REPORT.md §6` 续写 §8 子线 D 收口节；
4. `worklog.md` 追加（append-only）。

## 找不到时怎么办

- **headscale 二进制装不上** → 看 `interop/start-headscale.sh`，它记录了镜像版本与启动参数；
- **ssh 别名不通** → 检查 `~/.ssh/config` 与远端 `~/.ssh/authorized_keys`；不要用密码；
- **临时凭据泄露** → 立刻 `docker stop hs-isolated` + 销毁 `/tmp/hs-isolated` 卷；并把泄露字段入 git history 清理流程（filter-repo 副本操作，源仓历史不动）；
- **PASS 字符串缺失** → 报 issue 给 owner agent，不要自作主张改 interop 脚本凑 PASS。

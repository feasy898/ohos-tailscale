# D 线研究笔记：headscale 隔离互操作回归 —— 环境探测与可执行方案（2026-10-02）

- 日期：2026-10-02 ｜ 子线 D（TASK.md:50-56「互操作回归：把一次性历史证据变成可复跑门」）｜ 类型：S-环境前置研究（TASK.md:85）
- 任务三问：① 本机有无 docker；② GitHub Releases 直连下载 headscale **windows amd64** 二进制是否可行；③ `ssh root@100.64.0.7`（anolis-gpu-01，BatchMode）是否可达。
- 本仓对照物：`interop/`（start-headscale.sh / headscale.yaml / register.node.ts / h2c.node.ts / derp.node.ts）、`docs/oracle/protocol-notes.md`、`docs/architecture.md` §10.2 AU1–AU3、`worklog.md`、`TASK.md`。
- 纪律声明：本笔记全部环境结论来自**本会话实跑命令的输出**（§8 原始记录）；协议字节级语义引用已归档上游/仓库文件并给行号，无一处凭记忆补写（README.md:45 教训条）。本笔记是本次唯一写入的文件；探测临时文件已清理。

---

## 0. 探测环境

| 项 | 值 | 证据 |
|---|---|---|
| 执行探测的宿主 | Windows Server 10.0.20348.4893（`cmd //c ver`），node v22.23.2，curl 8.21.0（Git mingw64） | §8.1 |
| WSL | `wsl -l -v` → `* Ubuntu-24.04  Running  1`（**WSL1**；发行版内用户 `dev`/sudo，curl/wget 在，docker 无） | §8.2 |
| GPU 机 | `ssh dev-env-with-gpu`（= anuser@36.139.118.235 + `~/.ssh/wsl_key`）→ hostname `anolis-gpu-01`，Anolis（kernel 6.6.102-6.an23.x86_64），x86_64，node v22.23.2，**Docker server 29.8.1（anuser 免 sudo 可用）**，仓库在 `/opt/gpumachine/projects/ohos-tailscale`，磁盘 `/` 86% 已用（余 14G），端口 8080/3478/19090 空闲 | §8.4/§8.6 |

> 命名澄清：配置注释（`~/.ssh/config`）称 tailnet 名 `anolis-gpu-01 = 100.64.0.7`；GPU 机的**公网**地址是 36.139.118.235。两者是同一台机器的两条路径，见 §1.3。

---

## 1. 三问直答（全部为本会话实跑）

### 1.1 本机（Windows 宿主）有无 docker —— **无**

```
$ where docker  →  信息: 找不到 "docker"。
$ docker --version  →  bash: docker: command not found
```

WSL（Ubuntu-24.04）内同样无 docker；且该发行版是 **WSL1**（`wsl -l -v` VERSION 列 = 1）——WSL1 无真实 Linux 内核，容器运行时（Docker/Moby 需要 cgroup/namespace 内核特性）在 WSL1 内不可用。**结论：Windows 宿主 + 其 WSL1 均无 docker 能力；docker 只在 GPU 机上（29.8.1，免 sudo）**（§8.4：`docker info → server=29.8.1`、`docker ps` 可见常驻 otel collector 容器）。

### 1.2 GitHub Releases 直连下载 headscale windows amd64 —— **不可行，双重原因**

**原因一（决定性）：该资产根本不存在。** 对 `api.github.com/repos/juanfont/headscale/releases` 分页全量 74 个 release（4 页，`?per_page=100&page=1..4`）逐一正则筛查 `"name": "...windows..."` → **0 命中**。最新版 v0.29.4（2026-09-23 发布，正是本仓历史互操作所用版本，README.md:38）的资产全集为：

```
checksums.txt (767B) / headscale_0.29.4.tar.gz / darwin_amd64 / darwin_arm64 /
freebsd_amd64 / linux_amd64 (52,457,634B) / linux_amd64.deb / linux_arm64 / linux_arm64.deb
```

——**无任何 windows 构建**。headscale 上游不发布 Windows 二进制，换任何版本/任何代理都无此文件。

**原因二：本机到 `github.com` 的直连被阻断。** 实测（§8.3）：

```
$ curl -m 15 https://github.com/            →  Connection timed out（TCP 连不上，重试一致）
$ curl -m 20 -IL https://github.com/juanfont/headscale/releases/download/v0.29.4/…  →  HTTP=000（连接失败）
WSL 内同测：github.com 首页偶发 200（12s 贴超时边界），releases/download 3 次全 HTTP=000（~21s）
```

但分流明显：`api.github.com` 全程可达（28KB JSON ~2s；GPU 机上 0.9s）、`objects.githubusercontent.com` 可达（404 探针）、资产最终落点 `release-assets.githubusercontent.com` 可达。git 全局配置里另有 `http.https://github.com.proxy=socks5h://100.64.0.3:7864`（即曾有 SOCKS 代理通路）——**本次实测该代理已不可连**（21s connect fail，§8.5），不能作为现行依赖。

**可行替代（已实测验证到 206）：走 API 资产端点下载 linux_amd64**——`https://api.github.com/repos/juanfont/headscale/releases/assets/<id>` + 头 `Accept: application/octet-stream`，api.github.com 302 → 签名后的 Azure blob URL（`release-assets.githubusercontent.com`）。Windows 宿主实测：

```
$ curl -sS -m 90 -L -H "Accept: application/octet-stream" -r 0-1023 \
    "https://api.github.com/repos/juanfont/headscale/releases/assets/584455674"
HTTP=206 got=1024B t=3.8s redirects=1   # linux_amd64, asset id=584455674, size=52457634B
```

吞吐实测（1MB Range）：Windows 宿主 6.4KB/s（api 路由）/ WSL 内 11.7KB/s / **GPU 机直连 github.com 下载 32.9KB/s**（52MB ≈ 27min，GPU 机 github.com 慢但通）。**完整性锚**：GitHub API 的资产对象自带 `digest` 字段（sha256），可对下载物逐字节校验：

| 资产 | sha256（API `digest` 字段，经 TLS 取自 api.github.com） |
|---|---|
| `headscale_0.29.4_linux_amd64` | `212ed0a884c0d3541e094c4bebbe94397df6f4e01bd3d7f059c520cb55e0d757` |
| `checksums.txt` | `35e449d87ebec62543aeb7f8a56cebe0d59678538dfa4984e4e49dfaab2a697b` |

（checksums.txt 本身也可经同一 API 路由取回，形成「文件自校验 + 清单再校验」双锚。）

**docker 镜像路线**：GPU 机上 `ghcr.io` 可达——`curl -sI https://ghcr.io/v2/juanfont/headscale/manifests/v0.29.4` → **HTTP 401**（registry 标准 token 流前置，即网络可达、匿名拉取走 `docker pull` 正常授权）。

### 1.3 `ssh root@100.64.0.7`（BatchMode）—— **网络可达，root 认证被拒；改用既有别名即通**

```
$ ssh -o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new root@100.64.0.7 "echo SSH_OK"
root@100.64.0.7: Permission denied (publickey,gssapi-keyex,gssapi-with-mic,password).   exit=255
```

解读：TCP:22 打通且 sshd 应答（得到 SSH 层拒绝报文）——**主机可达**；但 root 无本机已配公钥，**认证不可用**（红线：不得尝试改远端 authorized_keys 或猜口令）。注意 `~/.ssh/config` 中既有注释「2026-09-27 …tailnet 名 anolis-gpu-01=100.64.0.7（当前本机→新机方向 ping/TCP 不通，疑新机防火墙，待修）」——本探测证明**该方向 TCP:22 现已可通**（相对 09-27 的状态变化，如实记录）。

**同会话实测已配置别名可用**（`~/.ssh/config`：`Host dev-env-with-gpu` = anuser@36.139.118.235 + `wsl_key`）：

```
$ ssh -o BatchMode=yes dev-env-with-gpu "echo SSH_ALIAS_OK; hostname; uname -sr; id -un; docker --version"
SSH_ALIAS_OK / anolis-gpu-01 / Linux 6.6.102-6.an23.x86_64 / anuser / Docker version 29.8.1   exit=0
```

**结论：互操作环境的 ssh 通道用 `dev-env-with-gpu` 别名（公网路径，已验证）；100.64.0.7 这条 tailnet 路径仅作「可达性已恢复」的记录，不作为依赖**（避免把互操作门挂在与生产 tailnet 共址的路径上，见 §5 红线 R2）。

---

## 2. 首选 / 降级链（裁定与理由）

TASK.md:54（D-1）的原始表述是「隔离 headscale 实例（**容器**，用后即弃）」。按实测环境裁定为：

| 级 | 路线 | 前提（本会话已验证） | 取舍理由 |
|---|---|---|---|
| **P0 首选** | **GPU 机 docker 全闭环**：`docker pull ghcr.io/juanfont/headscale:v0.29.4` → 端口全绑 `127.0.0.1` → 同机 node v22.23.2 跑 register/derp → 证据 scp 回本仓 | docker 29.8.1 免 sudo ✓；ghcr 可达（401 流）✓；node 同版本 ✓；仓库同机 ✓；端口空闲 ✓；loopback 全闭环，零跨主机依赖、零防火墙变量 | 满足 D-1「容器，用后即弃」字面；网络拓扑最简（全在 127.0.0.1）；GPU 机下载 33KB/s 一次到位；本仓历史判定输出（`INTEROP PASS`/`DERP INTEROP PASS`）无需改脚本 |
| P1 降级一 | GPU 机**裸进程**跑 linux_amd64 二进制（API 资产路由下载 + sha256 双锚校验；chmod +x 直接 serve），其余同 P0 | 下载路 206 实测 ✓；Anolis x86_64 与二进制匹配 ✓ | docker daemon 万一不可用时仍保「同机闭环 + 用后即弃（rm -rf WORK）」；隔离性靠临时目录+回环绑定 |
| P2 降级二 | **Windows 宿主 WSL1 路线（与 09-29 历史同构）**：GPU 机下载二进制 → `scp` 回 Windows → 拷入 WSL `~/interop/` → 原样跑 `interop/start-headscale.sh` → Windows 侧 node 对 `http://127.0.0.1:8080` 跑互操作 | WSL1 在跑、用户 `dev` 与 yaml 硬编码路径 `/home/dev/interop/*`（headscale.yaml:9,22,31,44）吻合；WSL1 与 Windows 共享回环（历史形态） | 二进制获取慢是痛点（直下 6–12KB/s 需 1.5–2.5h），故二进制走 GPU 中转；`start-headscale.sh:2`（「WSL 内执行」）与 yaml 即为此形态而写，还原历史证据最直接 |
| P3 兜底（默认禁用） | 第三方 GitHub 加速镜像（gh-proxy 类）下载二进制 | 未实测，本次刻意不碰 | 完整性风险：**必须**先校验 sha256 对 §1.2 表中 API digest、再校验 checksums.txt 内清单值，双锚任一不符即弃用；且镜像路线仅当 P0–P2 全灭时启用 |

**判定口径（三线一致）**：register 退出码 0 且输出含 `INTEROP PASS`（register.node.ts:264）；derp 退出码 0 且输出含 `DERP INTEROP PASS`（derp.node.ts:361）；D-3 证据落 `evidence/interop-20261002/`（TASK.md:56）。

**关于 D-1 里「h2c」的取舍**（纪律 6，自行裁定并说明）：`interop/h2c.node.ts` 经实查**无 CLI 入口**（全文件无 `main`/`process.argv`，grep 证据 §8.7），它是被 register/derp 导入的 H2-over-Noise 模块（register.node.ts:36 `import { H2OverNoise } from './h2c.node.ts'`）。因此 h2c 通路实际由 register 判定覆盖（register 对 `/machine/register` 与 `/machine/map` 的两次 POST 全走该模块）。若验收需要字面上的第三个 exit 0，最小改法是新增 `interop/h2c-run.node.ts` 薄壳（复用 H2OverNoise 对 `/health` 做一次 h2 GET/POST 冒烟），**不属于本只读研究，留给执行会话**。

---

## 3. 具体命令序列

### 3.1 P0：GPU 机 docker 全闭环（约 30–40 分钟）

```bash
# ── 阶段 0：临时工作区（全部产物用后即弃，不入任何 git 目录）──────────
ssh -o BatchMode=yes dev-env-with-gpu
WORK=$HOME/interop-20261002            # 或 /tmp/interop-20261002
mkdir -p "$WORK/state" "$WORK/evidence"/{env,headscale,register,derp}

# ── 阶段 1：取 headscale v0.29.4（镜像优先；无则走 API 资产路由）────────
docker pull ghcr.io/juanfont/headscale:v0.29.4
#   失败时的等价下载路（sha256 必须对上，锚见 §1.2）：
#   curl -sSL -H 'Accept: application/octet-stream' -o headscale \
#     "https://api.github.com/repos/juanfont/headscale/releases/assets/584455674"
#   echo "212ed0a884c0d3541e094c4bebbe94397df6f4e01bd3d7f059c520cb55e0d757  headscale" | sha256sum -c -

# ── 阶段 2：容器版配置（仓库 interop/headscale.yaml 改 4 个路径）────────
#   与 interop/headscale.yaml 逐字段同构，仅路径 /home/dev/interop/* → /var/lib/headscale/*
#   （noise.private_key_path、derp.server.private_key_path、database.sqlite.path、unix_socket）
cat > "$WORK/headscale.yaml" <<'EOF'
server_url: http://127.0.0.1:8080
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 127.0.0.1:19090
grpc_listen_addr: 127.0.0.1:50443
grpc_allow_insecure: false
noise:
  private_key_path: /var/lib/headscale/noise_private.key
prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
derp:
  server:
    enabled: true
    region_id: 999
    region_code: interop
    region_name: Headscale-Interop
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: /var/lib/headscale/derp_server_private.key
  auto_update_enabled: false
  update_frequency: 24h
  urls: []
  paths: []
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/headscale.db
dns:
  magic_dns: false
  base_domain: interop.internal
  override_local_dns: false
  nameservers:
    global: []
log:
  level: debug
  format: text
unix_socket: /var/lib/headscale/headscale.sock
unix_socket_permission: "0770"
EOF

# ── 阶段 3：起容器（端口只绑宿主回环；禁 --network host，理由见 §5-R2）──
docker run -d --rm --name headscale-interop-20261002 \
  -p 127.0.0.1:8080:8080 -p 127.0.0.1:3478:3478/udp -p 127.0.0.1:19090:19090 \
  -v "$WORK/headscale.yaml":/etc/headscale/config.yaml:ro \
  -v "$WORK/state":/var/lib/headscale \
  ghcr.io/juanfont/headscale:v0.29.4 serve --config /etc/headscale/config.yaml
#   注：官方镜像默认入口即读 /etc/headscale/config.yaml；显式写出 --config 便于排障。
#   首次执行时若镜像入口参数有出入，以 `docker run --rm <img> headscale --help` 实查为准，不凭记忆。

# ── 阶段 4：探活 + 临时凭据（1h 过期预授权密钥，管道内流转，不落盘）────
curl -fsS http://127.0.0.1:8080/health           # 通过标准 = HTTP 200（start-headscale.sh:15 同款探活）
docker exec headscale-interop-20261002 headscale --version        # 证据：版本号入 evidence
docker exec headscale-interop-20261002 headscale users --help     # ⚠ 旗标以 --help 实查为准（见 §7-T8）
docker exec headscale-interop-20261002 headscale users create interop
AUTHKEY=$(docker exec headscale-interop-20261002 headscale preauthkeys \
            create --user interop --reusable --expiration 1h | grep -oE '[A-Za-z0-9]{20,}')
#   derp.node.ts 需要用同一把 key 注册 A、B 两个节点 ⇒ key 必须 reusable；若 v0.29 旗标名不同按 --help 修正。
#   AUTHKEY 只存 shell 变量/环境变量，禁止 echo 进 evidence、禁止写进任何文件。

# ── 阶段 5：互操作三连（GPU 机上已有仓库与 node v22.23.2）──────────────
cd /opt/gpumachine/projects/ohos-tailscale
git status --porcelain >/dev/null   # 确认工作树干净再跑（防把证据写进仓库树；本线不 commit 不 push）
node --experimental-strip-types interop/register.node.ts \
      http://127.0.0.1:8080 "$AUTHKEY" ohos-d-reg 2>&1 | tee "$WORK/evidence/register/run1.log"
test ${PIPESTATUS[0]} -eq 0 && grep -q 'INTEROP PASS' "$WORK/evidence/register/run1.log"
node --experimental-strip-types interop/derp.node.ts \
      http://127.0.0.1:8080 "$AUTHKEY" 2>&1 | tee "$WORK/evidence/derp/run1.log"
test ${PIPESTATUS[0]} -eq 0 && grep -q 'DERP INTEROP PASS' "$WORK/evidence/derp/run1.log"
docker logs headscale-interop-20261002 > "$WORK/evidence/headscale/serve.log" 2>&1   # ⚠ 按 §4 脱敏

# ── 阶段 6：证据回传本仓 + 环境销毁（用后即弃）────────────────────────
# 在 Windows 侧：
ssh -o BatchMode=yes dev-env-with-gpu "cd $WORK/evidence && find . -type f -exec sha256sum {} + | sort -k2" > manifest.raw
scp -r dev-env-with-gpu:"$WORK/evidence" D:/new-workspace/ohos-tailscale/evidence/interop-20261002/
# 销毁（顺序：容器→镜像可选→工作区；AUTHKEY 随 shell 会话消失）：
ssh -o BatchMode=yes dev-env-with-gpu "docker stop -t 5 headscale-interop-20261002 && \
  docker image rm ghcr.io/juanfont/headscale:v0.29.4 && rm -rf $WORK"
```

**h2c 判定**：由 register 日志覆盖（其 `/machine/register`+`/machine/map` 两次 H2 POST 即 h2c 通路，§2 取舍）；若需独立 exit code，见 §2 末段薄壳方案。

### 3.2 P1：GPU 机裸进程（与 P0 的差异）

```bash
# 阶段 1 换成：API 资产路由下载 + 双锚校验（sha256sum -c 必须过）
# 阶段 3 换成（无 docker）：
chmod +x "$WORK/headscale"
( cd "$WORK" && setsid nohup ./headscale serve --config headscale.yaml > serve.log 2>&1 < /dev/null & )
#   形态与 interop/start-headscale.sh:10 一致（setsid 脱离会话），但 WORK 是临时目录而非 $HOME/interop
# 阶段 4 的 docker exec 换成："$WORK/headscale" users create … / preauthkeys create …
#   （headscale CLI 会自动定位同目录配置/或显式 --config；以 --help 实查为准）
# 阶段 6 销毁：pkill -f 'headscale serve' ; rm -rf "$WORK"
```

### 3.3 P2：Windows 宿主 WSL1（历史同构还原）

```bash
# ① 二进制走 GPU 中转（GPU 直下 33KB/s ≈ 27min；本机直下 6-12KB/s 需 1.5-2.5h，不值）
ssh dev-env-with-gpu 'curl -sSL -H "Accept: application/octet-stream" -o /tmp/headscale \
  "https://api.github.com/repos/juanfont/headscale/releases/assets/584455674" \
  && echo "212ed0a8…d757  /tmp/headscale" | sha256sum -c -'
scp dev-env-with-gpu:/tmp/headscale D:/new-workspace/ohos-tailscale/.tmp-interop/headscale
ssh dev-env-with-gpu 'rm -f /tmp/headscale'

# ② 拷入 WSL 并按历史形态启动（脚本与 yaml 原样使用，路径 /home/dev/interop 硬编码刚好匹配 dev 用户）
wsl.exe -d Ubuntu-24.04 -- bash -lc '
  mkdir -p ~/interop && cp /mnt/d/new-workspace/ohos-tailscale/.tmp-interop/headscale ~/interop/ &&
  cp /mnt/d/new-workspace/ohos-tailscale/interop/{start-headscale.sh,headscale.yaml} ~/interop/ &&
  chmod +x ~/interop/headscale ~/interop/start-headscale.sh && bash ~/interop/start-headscale.sh'
# start-headscale.sh:15 自带 /health 探活、:18 打印 /key 前 100 字节 —— 两项即启动成功判定

# ③ Windows 侧跑互操作（node 对 127.0.0.1:8080；WSL1 与 Windows 共享回环，历史形态）
cd /d/new-workspace/ohos-tailscale
AUTHKEY=$(wsl.exe -d Ubuntu-24.04 -- bash -lc 'headscale preauthkeys --help >/dev/null 2>&1; ~/interop/headscale preauthkeys create --user interop --reusable --expiration 1h 2>/dev/null | grep -oE "[A-Za-z0-9]{20,}"')
node --experimental-strip-types interop/register.node.ts http://127.0.0.1:8080 "$AUTHKEY" ohos-d-reg | tee evidence/interop-20261002/register/run1.log
node --experimental-strip-types interop/derp.node.ts     http://127.0.0.1:8080 "$AUTHKEY" | tee evidence/interop-20261002/derp/run1.log

# ④ 销毁
wsl.exe -d Ubuntu-24.04 -- bash -lc 'pkill -f "headscale serve"; rm -rf ~/interop'
rm -rf .tmp-interop
```

### 3.4 备用：本机直下分片并行（仅当 GPU 机不可达时）

api.github.com 资产路由支持 Range（206 实测），单流仅 6–12KB/s，可 8 分片并行（每分片独立经 API 取 302）：

```bash
SIZE=52457634; AID=584455674; C=$(( (SIZE+7)/8 ))
for i in 0 1 2 3 4 5 6 7; do
  o=$((i*C)); e=$((o+C-1)); [ $e -ge $SIZE ] && e=$((SIZE-1))
  curl -sS -L -H 'Accept: application/octet-stream' -r $o-$e -o part.$i \
    "https://api.github.com/repos/juanfont/headscale/releases/assets/$AID" &
done; wait
cat part.0 part.1 part.2 part.3 part.4 part.5 part.6 part.7 > headscale && rm part.*
echo "212ed0a884c0d3541e094c4bebbe94397df6f4e01bd3d7f059c520cb55e0d757  headscale" | sha256sum -c -
```

⚠ 匿名 GitHub API 限额 60 请求/小时/IP：一次分片下载约消耗 8–16 个请求（含重试），**一轮失败不要立刻重试**，先 `curl -sI https://api.github.com/ | grep -i x-ratelimit-remaining` 查余量（§7-T3）。

---

## 4. 证据目录规划 `evidence/interop-20261002/`

TASK.md:56（D-3）：「判定输出 + 环境参数（headscale 版本/容器 id）落 `evidence/interop-<date>/`」。规划：

```
evidence/interop-20261002/
├─ README.md                      # 环境参数总表：路线（P0/P1/P2）、headscale 版本串、容器 id/进程 pid、
│                                 #   主机名/kernel、node 版本、起止时间、三判定（register/derp exit code + PASS 行摘录）
├─ env/
│  ├─ probe-20261002.md           # 本笔记 §8 探测命令与输出的固化快照（复跑时的环境基线）
│  └─ sha256-anchors.txt          # §1.2 的 digest 双锚 + 下载物实测 sha256（-c 的通过输出）
├─ headscale/
│  ├─ serve.log                   # docker logs / serve stdout（debug 级）；提交前过 §4 脱敏清单
│  └─ config-effective.yaml       # 实际下发给容器的 yaml（无凭据字段，可直接入仓）
├─ register/
│  └─ run1.log                    # tee 原样输出，末尾含 [5/5] MapResponse 解析 ✓ 与 INTEROP PASS 行
├─ derp/
│  └─ run1.log                    # tee 原样输出，末尾含 DERP INTEROP PASS 行
└─ manifest.sha256                # 全目录文件 sha256 清单（复跑比对用）
```

**脱敏清单（入仓前逐文件过一遍）**：① authKey（`preauthkeys create` 输出、任何 `hsauthkey`/20+ 位随机串形态）——headscale serve debug 日志**可能**回显注册请求体，出现即整行删除；② noise/derp/sqlite 私钥文件本身永不入 evidence（只留 `sha256sum state/*` 的哈希行可）；③ 机器名/IP：GPU 机公网 IP 36.139.118.235 与 tailnet 地址 100.64.0.7 按 `PUBLIC-SCRUB-NOTE.md` 口径，证据里写作占位（如 `GPU-PUBLIC-IP`/`GPU-TAILNET-IP`）——本仓刚做过公开脱敏（见 git log b996b96 与 PUBLIC-SCRUB-NOTE.md），勿再引入需清洗的真实地址；④ `/key` 返回的控制面公钥、脚本打印的 nodekey/mkey 公钥前缀属公钥，可保留（对齐 protocol-notes.md:256-258 的打码边界：只打码私钥与令牌）。

**目录入库口径**：`evidence/` 目前不在 `.gitignore`（本会话实读确认，§8.6），按 D-3 意图应入仓；但 `.gitignore` 已有「Secrets（任何真实凭据不得入库）」条款兜底。提交动作由编排脚本统一做（本线不 git）。

---

## 5. 红线（本线专用，违者即停）

- **R1 只用隔离实例**：headscale 只能以 §3 的临时容器/临时进程形态存在，监听只绑 `127.0.0.1`；禁 `--network host`（GPU 机上有生产 tailscale，host 网络会让容器 100.64.0.0/10 前缀与 tailscale0 的 CGNAT 语义同栖一台栈，徒增混淆且无必要——容器默认 bridge + 回环端口映射即可闭环）。
- **R2 绝不碰生产 tailnet**：生产控制面是 `https://headscale.example.internal`（protocol-notes.md:24，取证机所在 tailnet 的自定义 ControlURL）。本线一切 HTTP 只对 `http://127.0.0.1:8080`；禁对任何生产域名/100.64.0.0/10 内地址发起注册、MapRequest 或 DERP 连接；不在 GPU 机/本机执行任何改状态的 `tailscale` CLI；ssh 到 GPU 机仅限 `dev-env-with-gpu` 别名的只读运维命令（起/停自建的隔离容器）。
- **R3 临时凭据用后即弃、不入仓**：AUTHKEY 只在 shell 变量/管道中流转（§3.1 阶段 4 注记）；预授权密钥 1h 过期 + 容器销毁 + `rm -rf $WORK` 三重兜底；noise/derp/sqlite 状态全部随 `$WORK/state` 销毁；证据按 §4 脱敏清单清洗后才可入 `evidence/`。
- **R4 绝不 push**：本线在 GPU 机仓库副本上跑互操作时**不 commit、不 pull、不 push**；证据以 scp 物理回传，不走 git 传输；GPU 机仓库若恰有未推送提交，如实上报、不代推。
- **R5 环境用后即弃**：容器名固定带日期（`headscale-interop-20261002`）+ `--rm`；WORK 目录一次一线；收尾后用 `docker ps -a | grep interop` 与 `ls $WORK` 双查确认零残留。
- **R6 下载完整性**：二进制/镜像以 v0.29.4 为准（与 AU1–AU3 上游核对基线、09-29 历史证据同版本，architecture.md:537-539）；凡绕过官方镜像的下载（API 路由、第三方镜像）必须过 §1.2 sha256 锚；**禁**执行任何未过校验的二进制。

---

## 6. 与本仓现有实现的衔接点（含字节级预期）

互操作门「PASS」隐含验收的字节级协议形态，全部有仓内文件行号锚，复跑失败时按此对位排查：

| # | 衔接点 | 锚（文件:行） | 字节级细节 |
|---|---|---|---|
| 1 | 控制面密钥发现 | register.node.ts:56-92；start-headscale.sh:18 | `GET /key?v=148`；兼容纯 hex 与 JSON `{"legacyPublicKey","publicKey"}` 两形态；`mkey:` 前缀剥离后须匹配 `^[0-9a-f]{64}$` |
| 2 | ts2021 升级 + Noise IK | register.node.ts:169-200, 220-222；architecture.md:537（AU1） | initiation 101B（2B BE 版本=148 内嵌头 + Noise 消息），`Upgrade: tailscale-control-protocol` + `X-Tailscale-Handshake: base64(initiation)`；握手响应**恰 51B**（`readExactAllowExtra(duplex, 51)`），其后残留字节（EarlyNoise 开头）须 `prepend` 归还流 |
| 3 | EarlyNoise 跳读 | h2c.node.ts:5-7, 61-64 | `5B magic + 4B BE 长度 + JSON{NodeKeyChallenge}`，connect() 只跳过不消费 |
| 4 | HTTP/2 over Noise（h2c） | h2c.node.ts:18, 42-54, 188-204 | 前奏 `PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n`（24B）+ 空 SETTINGS；帧头 9B（3B 长度 BE + type + flags + 4B 流 id）；HPACK 用「字面量、不索引、不 Huffman」（首字节 0x00） |
| 5 | 注册与地图载荷 | register.node.ts:229-260；architecture.md:539（AU3） | tailcfg **JSON over HTTP/2**：`POST /machine/register`、`POST /machine/map`（Stream=true）；`capabilityVersion=148`；map 流每条 MapResponse 带 **4B 小端**长度前缀（h2c.node.ts:131-133, 163-167 实测锚定） |
| 6 | DERP 互通 | derp.node.ts:281-287, 317-321；architecture.md:538（AU2） | `POST /derp` + `Upgrade: DERP` → 101 → 裸连接即 DERP 帧；帧头第二字段 **u32 大端**；同 register 时的 node key 必须复用（`makeClient` 用同一 keyPair，derp.node.ts:289-308）；ServerKey/ClientInfo/ServerInfo 握手后 `SendPacket → RecvPacket` |
| 7 | baseUrl 必须带端口 | derp.node.ts:297（`derpPort: Number(url.port)`） | `http://127.0.0.1:8080` 不能省略 `:8080`，否则 derpPort=0 落 443 |
| 8 | 配置面 | interop/headscale.yaml:1-45 | region 999（`interop`/`Headscale-Interop`）、`100.64.0.0/10` + `fd7a:115c:a1e0::/48` 前缀、embedded DERP + STUN 3478、magic_dns=false——容器版仅改 4 个路径（§3.1 阶段 2） |

代码层依赖（互操作脚本 → packages/，全部为包名/相对 `.ts` 导入）：register.node.ts:18-35（common `ArrayRng`/`KEY_LEN_BYTES`、crypto `x25519GenerateKeyPair`、noise `controlbaseBuildInitiation/CompleteHandshake`、control `tailcfg` 编解码三件）；derp.node.ts:14-30（另加 derp `DerpClient`/`DerpConnection`/`DerpDialer`/`DerpNode`）。**这批导入即 D 线回归对 8 包公开面的真实消费面**——复跑同时就是接口冻结的最强回归。注意 register/derp 脚本内部用 `randomBytes`/`Date.now`（register.node.ts:16, 51-53；derp.node.ts:12, 305-306）：合法，因其属 `packages/` 之外 Node 侧胶水（脚本头注自述），不触发 G0-5；但任何为复跑而新写的**仓内可复跑入口**（如 `interop/run.sh`、npm script）也不得把这类用法带进 `packages/`。

---

## 7. 实现陷阱清单（按踩坑概率排序）

- **T1 windows 资产不存在**：不要按任务字面找 `headscale_*_windows_amd64`——74 个 release 全查为 0 命中（§1.2）；任何「下载 windows 版」的脚本都会 404/被墙，直接按 §2 选 linux_amd64 路线。
- **T2 `github.com` 直连被墙、`api.github.com` 可达**：`browser_download_url`（github.com）在本机不可用；必须走 API 资产端点（`Accept: application/octet-stream`）。git config 里的 socks5 代理（100.64.0.3:7864）当前**不可连**，不得写进方案。
- **T3 API 速率限制**：匿名 60 req/h/IP；分片并行一轮就烧 8–16 个请求；失败后先查 `x-ratelimit-remaining` 再动，别连环重试。
- **T4 单流吞吐**：本机 6–12KB/s、GPU 33KB/s → 52MB 需 27min–2.5h；首选 GPU 一次下载（P0/P1），P2 时二进制 scp 中转；本机直下只留分片并行备用（§3.4）。
- **T5 sha256 双锚**：API `digest` 字段是唯一经 TLS 可信通道拿到的校验值（`212ed0a8…` linux_amd64；checksums.txt `35e449d8…`）；第三方镜像路线必须双锚齐验，缺一即弃。
- **T6 root@100.64.0.7 认证被拒**：属预期（无 root 公钥）；用 `dev-env-with-gpu` 别名（anuser@36.139.118.235 + wsl_key，实测 exit 0）；**禁**改远端 authorized_keys、禁口令尝试。ssh 会打出 ControlMaster 陈旧套接字告警（`mux_client_request_session: read from master failed`），不影响执行；要清就删 `~/.ssh/cm/anuser@36.139.118.235-22`。
- **T7 100.64.0.7 可达性是「新近变化」**：ssh config 注释（2026-09-27）称该方向 ping/TCP 不通，本次实测 TCP:22 已通——说明对端防火墙已改。**不要**因此把互操作依赖改挂到 tailnet 路径上（红线 R2 + 路径易再漂移）；证据里只作记录。
- **T8 headscale CLI 旗标版本敏感**：`users create`/`preauthkeys create` 的 `--user` vs `--namespace`、`--reusable`/`--expiration` 等旗标随大版本变过；执行时**第一步先 `--help` 实查**（§3.1 阶段 4 已内置），不凭本笔记或记忆写死（本仓纪律 TASK.md:82）。
- **T9 容器镜像入口/配置路径**：显式 `serve --config /etc/headscale/config.yaml`；若镜像入口不符，以 `docker run --rm <img> headscale --help` 实查修正；首次 pull 失败（ghcr 抖动）就走 API 资产路由下载二进制（P1 等价替换）。
- **T10 yaml 路径硬编码**：容器版必须改 4 处 `/home/dev/interop/*` → `/var/lib/headscale/*`（noise key、derp key、sqlite、unix_socket，headscale.yaml:9,22,31,44）；漏改任意一处容器直接起不来。
- **T11 reusable key 是 derp 前置**：derp.node.ts 用同一把 authKey 注册 A、B 两节点（derp.node.ts:312-315），预授权密钥必须 `--reusable`；一次性 key 会在第二步注册时报已用。
- **T12 WSL1 限制**：WSL1 无 systemd、无 docker；`start-headscale.sh` 的 `setsid nohup`（start-headscale.sh:10）在 WSL1 可用；WSL1↔Windows 回环互通是历史形态，起服后以 `curl http://127.0.0.1:8080/health`（Windows 侧）实测为准。
- **T13 证据脱敏**：headscale debug 日志可能含注册请求体（含 authKey）——入仓前按 §4 清单整行删除；GPU 公网 IP/tailnet IP 用占位符（仓刚做完公开清洗，见 git log b996b96）。
- **T14 `evidence/` 不在 .gitignore**（本会话实读确认）：证据可入仓；但工作区临时目录（`.tmp-interop/`、GPU 侧 `$WORK`）不在仓内，用后即删。
- **T15 Node 运行形态**：node v22.23.2 裸跑 `.ts`（type stripping 默认开，arkts-constraints.md 附录 A）即可；沿用脚本头注的 `--experimental-strip-types` 旗标形态也无害——两台机器（Windows/WSL/GPU）实测同为 v22.23.2，无版本漂移。
- **T16 GPU 磁盘水位**：`/` 已用 86%（余 14G）——镜像+二进制+state ≈ 300MB 无碍，但收尾必须 `rm -rf $WORK` + 删镜像，不为下一轮「留方便」。
- **T17 判定自动化**：`tee` 后判 PASS 要用 `PIPESTATUS[0]`（bash）而不是 `$?`（那是 tee 的退出码）——D-2 固化 npm script 时按此写，避免「tee 成功 = 互操作成功」的假绿。

---

## 8. 探测原始记录（命令 → 输出摘要；全部于 2026-10-02 本会话实跑）

1. **Windows 宿主工具链**：`where docker curl ssh wsl` → docker 无；curl×2（Git mingw64 8.21.0 / System32）；ssh×3；wsl.exe 在。`docker --version` → command not found。`node --version` → v22.23.2。`cmd //c ver` → 10.0.20348.4893。
2. **WSL**：`wsl -l -v` → `* Ubuntu-24.04 Running 1`；发行版内：`/etc/os-release` → 24.04.4 LTS；`which docker` → 无（curl/wget 在）；`id` → uid=1000(dev) groups=dev,27(sudo)；`free -h` → 127Gi 内存；`df -h /` → 88% 已用；egress：`api.github.com` 200/2.2s，`github.com` 首页 200/12.0s（贴超时），releases/download 3×HTTP=000（~21s）；api 资产路由 1MB Range → 206，706749B/60.3s ≈ 11.7KB/s。
3. **GitHub 直连**：`curl -m 15 https://github.com/` → TCP 超时（重试一致）；`objects.githubusercontent.com/` → 404（可达）；`raw.githubusercontent.com` → 超时；`api.github.com/repos/juanfont/headscale/releases/latest` → 200/28.9KB/2.0s；资产 Range 探针（1KB）→ **206**，1 跳重定向至 `release-assets.githubusercontent.com`；1MB Range → 206，585864B/91s ≈ 6.4KB/s。
4. **GPU 机**：`ssh -o BatchMode=yes dev-env-with-gpu "…"` → exit 0：hostname=anolis-gpu-01，kernel 6.6.102-6.an23.x86_64，user=anuser，`docker --version` → 29.8.1；`docker info` → server=29.8.1；`docker ps` → 常驻 otel collector（5 天）；node v22.23.2；仓库 `/opt/gpumachine/projects/ohos-tailscale` 存在；egress：api.github 200/0.9s，github.com 慢通（10s 内部分响应），release 1MB Range → **206 / 32.9KB/s**；ghcr.io：`/v2/` HEAD=405、headscale manifest HEAD=**401**（可达、标准 token 流）；uname -m=x86_64；`df -h` → 86% 用/余 14G；`ss -tln | grep -E ':8080|:3478|:19090'` → 全空闲。
5. **ssh root@100.64.0.7**：`ssh -o BatchMode=yes -o ConnectTimeout=8 root@100.64.0.7 "echo SSH_OK"` → `Permission denied (publickey,gssapi-keyex,gssapi-with-mic,password)`，exit=255（TCP/sshd 可达、root 认证被拒）。
6. **本机 git/ssh 配置**（只读）：`git config --global --list` → `http.https://github.com.proxy=socks5h://100.64.0.3:7864`（等 4 条）；实测 `curl --proxy socks5h://100.64.0.3:7864 …` → 21s connect fail（代理当前不可用）；`~/.ssh/config` → `dev-env-with-gpu`（anuser@36.139.118.235 + wsl_key，注释载明 tailnet 名 anolis-gpu-01=100.64.0.7 与 09-27 时该方向不通）；`.gitignore` 实读：含 Secrets 条款，无 evidence/ 条目。探测临时文件（hs-probe-*.json）已 `rm` 清理。
7. **h2c 入口查证**：`grep -n "main|process.argv|usage" interop/h2c.node.ts` → 零命中（281 行纯模块）；`wc -l` → 281。register/derp 用法行实读（register.node.ts:11,45；derp.node.ts:8,39）。
8. **release 全量筛查**：`releases?per_page=100&page=1..4` → 74 tags（v0.29.4 … 最早页），windows 资产 0 命中；v0.29.4 资产 9 项全列于 §1.2（含 size 与 digest）。

---

## 9. 结论

三问答案：**docker——本机无、GPU 机有（29.8.1 免 sudo）；headscale windows amd64——上游从未发布（74 release 全查 0 命中）且 github.com 直连被墙，双原因不可行，linux_amd64 经 API 资产路由可下载且 sha256 可锚；ssh root@100.64.0.7——网络可达但 root 认证被拒，改用既有 `dev-env-with-gpu` 别名即完全可用。** 因此首选方案裁定为 **P0：GPU 机 docker 隔离实例全闭环（回环绑定 + 用后即弃）**，完整命令序列见 §3.1；判定输出与 `evidence/interop-20261002/` 落盘规划见 §4；红线具体化为 §5 的 R1–R6。执行会话按 §3.1 起跑，遇 CLI 旗标/镜像入口出入按 §7-T8/T9 现场实查修正，不回询。

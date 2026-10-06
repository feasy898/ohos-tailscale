# Linux 本地构建指南（devecocli + 官方 Command Line Tools）

> 2026-10-06 实测打通。此前"Linux 无华为账号不可构建"的结论已过时——`@deveco/deveco-cli` 已公网分发（2026-06 起），CLT zip 可人工搬运。

## 一次性环境

```bash
# 1) devecocli 编排器（npmmirror 可装；stable=1.3.0-stable）
npm install -g @deveco/deveco-cli@stable --registry=https://registry.npmmirror.com

# 2) 官方 Command Line Tools ≥26.0.0（developer.huawei.com 登录下载 Linux x64 zip，
#    当前用 26.0.0.851，2.2GB）解压到任意 ASCII 路径
sudo apt-get install -y openjdk-17-jdk-headless libgl1 libglib2.0-0 libxi6 libnss3
```

## 每次构建

```bash
export DEVECO_CLI_CLT_PATH=/home/pan-ding/deveco/command-line-tools
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
# ⚠ 工程路径必须全 ASCII（hvigor 00306003 拒绝中文路径——仓目录名"鸿蒙tailscale"会炸）
cd /home/pan-ding/ohos-build-wt/app   # git worktree, 见下
devecocli build --build-mode debug
# 产物: entry/build/default/outputs/default/entry-default-unsigned.hap
```

## ASCII worktree（本仓目录含中文时的标准做法）

```bash
git -C /home/pan-ding/workspace/鸿蒙tailscale/ohos-tailscale worktree add /home/pan-ding/ohos-build-wt HEAD
```

## 已知边界

- 未签名 HAP：签名材料（p12/cer/p7b）经 AGC CSR 流程产出后用 `devecocli signature generate` 或 hap-sign-tool 离线签名（CSR 已生成：鸿蒙tailscale-certs/ohos-debug.csr，密钥本地 0600）。
- 模拟器：`devecocli emulator image` 需 `devecocli auth login`（华为账号交互授权）后可用。
- 云端等价路径：CNB 流水线已实测可产同款未签名 HAP（见 澄迈杯/AGENTS/overnight-20261005/cnb-鸿蒙沙箱探索报告.md，第三方镜像 CLT+SKIP_VERSION_CHECK；官方 CLT 烤镜像后更优）。

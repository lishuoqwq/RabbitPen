---
title: Kubernetes基于containerd集群安装
published: 2026-03-21
pinned: true
description: Kubernetes基于containerd集群安装标准化操作流程
category: Linux
author: Bunny
image: https://picture.whgd.eu.org/file/1776755917588.png
---

## Kubernetes 集群安装 SOP（基于 containerd）

## 1. 目的

本文档为标准化操作流程（SOP），用于指导运维人员在 Linux 服务器上通过 `kubeadm + containerd` 方式安装 Kubernetes 集群，确保部署过程规范、可复用、可排查，最终完成以下目标：

- 初始化系统内核与网络参数，满足 K8s 运行前置要求
- 安装并配置 containerd 容器运行时，确保与 K8s 兼容
- 配置镜像加速，解决国内网络环境下镜像拉取慢、失败问题
- 安装 Kubernetes 核心组件（kubelet、kubeadm、kubectl）
- 完成 Master 节点初始化与 Node 节点加入，搭建集群架构
- 安装 Calico 网络插件，实现 Pod 网络通信
- 完成集群验证，确保组件正常运行、网络互通

## 2. 环境规划

### 2.1 节点规划示例

| 角色        | 主机名    | IP 地址       | 备注                                         |
| :---------- | :-------- | :------------ | :------------------------------------------- |
| Master 节点 | k8smaster | 10.135.40.150 | 集群控制平面，1 台即可（生产环境建议高可用） |
| Node 节点   | k8snode1  | 10.135.40.151 | 工作节点，负责运行 Pod                       |
| Node 节点   | k8snode2  | 10.135.40.152 | 工作节点，负责运行 Pod                       |
| Node 节点   | k8snode3  | 10.135.40.153 | 工作节点，负责运行 Pod                       |

### 2.2 版本信息示例

| 组件       | 版本           | 说明                                 |
| :--------- | :------------- | :----------------------------------- |
| Kubernetes | v1.34.6        | 稳定版，与 Calico v3.29.2 兼容       |
| containerd | 系统源默认版本 | 通过 apt 安装，便于维护升级          |
| Calico     | v3.29.2        | CNI 网络插件，支持 Pod 网络通信      |
| Pause 镜像 | 3.10           | Pod Sandbox 基础镜像，适配国内镜像源 |

实际部署时，请确保 Kubernetes 版本、Pause 镜像版本、Calico 版本互相兼容，避免版本不匹配导致集群异常。

## 3. 前置条件

在执行任何安装操作前，必须确保所有节点满足以下条件，否则会导致部署失败或集群异常：

1. 时间同步：所有节点系统时间一致（误差不超过 1 分钟），建议配置 chrony 或 ntpd 时间同步服务。
2. 网络互通：所有节点之间（Master 与 Node、Node 与 Node）网络互通，无防火墙/安全组拦截。
3. 主机解析：所有节点可通过主机名互相解析，可通过配置 `/etc/hosts` 或企业 DNS 实现。
4. 权限要求：所有节点具备 root 权限或 sudo 权限（执行命令时需加 sudo）。
5. 端口放行：防火墙、安全组、云厂商 ACL 已放通 K8s 所需端口（详见附录）。
6. Swap 关闭：所有节点已关闭 Swap，K8s 要求必须关闭 Swap 否则 kubelet 无法正常运行。

## 4. 安装范围说明

为提高部署效率，明确各节点执行范围，按节点角色划分操作步骤，避免重复操作：

### 4.1 所有节点（Master + Node）必执行

- 系统初始化（关闭 Swap、加载内核模块、配置网络参数）
- 安装并配置 containerd 容器运行时
- 配置镜像加速（解决国内网络拉取镜像问题）
- 安装 kubelet、kubeadm、kubectl 组件
- 设置主机名与 hosts 解析

### 4.2 仅 Master 节点执行

- 执行 `kubeadm init` 初始化控制平面
- 配置 kubectl 命令行工具
- 安装 Calico 网络插件
- 生成 Node 节点加入集群的 `kubeadm join` 命令

### 4.3 仅 Node 节点执行

- 执行 Master 节点生成的 `kubeadm join` 命令，加入集群

## 5. 系统初始化（所有节点执行）

系统初始化是 K8s 部署的基础，所有节点必须严格执行，每一步均需验证是否成功。

### 5.1 关闭 Swap（必须执行）

执行以下命令，立即关闭 Swap 并禁止开机自动启用：

```bash
swapoff -a
sed -i '/^\/swap.img/s/^/# /' /etc/fstab
```

#### 说明

- `swapoff -a`：立即关闭当前系统的 Swap 分区，无需重启。
- `sed -i ...`：注释 `/etc/fstab` 中 Swap 相关配置，防止重启后 Swap 自动启用。

#### 验证方式

```bash
free -h
swapon --show
```

若 `swapon --show` 无任何输出，说明 Swap 已成功关闭。

### 5.2 加载内核模块

K8s 依赖`overlay` 和 `br_netfilter` 两个内核模块，执行以下命令加载并设置开机自动加载：

```bash
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sysctl --system
```

#### 说明

- `overlay`：容器镜像与容器文件系统的核心依赖模块，支持分层存储。
- `br_netfilter`：使 Linux bridge 流量能够被 iptables 处理，是 K8s CNI 网络的基础。

#### 验证方式

```bash
lsmod | grep overlay
lsmod | grep br_netfilter
```

若两条命令均有输出，说明内核模块加载成功。

### 5.3 配置内核网络参数

配置 K8s 所需的内核网络参数，确保网络转发、桥接流量正常：

```bash
# 1. 写入配置
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

# 2. 加载内核模块
modprobe overlay
modprobe br_netfilter

# 3. 让配置生效（关键！你之前少了这一步！）
sysctl --system
```

#### 说明

- `net.bridge.bridge-nf-call-iptables = 1`：让桥接流量进入 iptables 规则，实现网络策略控制。
- `net.bridge.bridge-nf-call-ip6tables = 1`：支持 IPv6 桥接流量，适配未来扩展。
- `net.ipv4.ip_forward = 1`：启用 IPv4 转发，是 Pod 之间、Pod 与外部网络通信的必要条件。

#### 验证方式

```bash
sysctl net.bridge.bridge-nf-call-iptables
sysctl net.bridge.bridge-nf-call-ip6tables
sysctl net.ipv4.ip_forward
```

三条命令的输出结果均为 `1`，说明内核网络参数配置成功。

### 5.4 安装ipvs

```sh
apt install -y ipset ipvsadm

# 配置ipvsadm的模块，这些都是算法模块，目的是为了让开机自动加载
cat << EOF | tee /etc/modules-load.d/ipvs.conf
ip_vs
ip_vs_rr
ip_VS_wrr
ip_vs_sh
nf_conntrack
EOF

# 编写脚本自动加载
cat << EOF | tee ipvs.sh
#!/bin/sh
modprobe -- ip_vs
modprobe -- ip_vs_rr
modprobe -- ip_vs_wrr
modprobe -- ip_vs_sh
modprobe -- nf_conntrack
EOF

sh ipvs.sh
# 验证脚本是否生效
lsmod | grep ip_vs
```

## 6. 安装与配置 containerd（所有节点执行）

containerd 是 K8s 官方推荐的容器运行时，替代传统 Docker 运行时，步骤如下：

### 6.1 安装 containerd

通过系统包管理器 apt 安装，操作简单且便于后续维护升级：

```bash
apt update && apt install -y containerd
```

### 6.2 生成默认配置文件

生成 containerd 的默认配置文件，便于后续修改镜像源、cgroup 驱动等参数：

```bash
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml
```

#### 说明

若不生成显式配置文件，containerd 会使用内置默认值运行，不利于统一管理和问题排查。

### 6.3 修改 cgroup 驱动（关键步骤）

kubeadm 推荐 containerd 与 kubelet 使用一致的 `systemd` cgroup 驱动，否则会导致 kubelet 启动失败：

```bash
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
```

#### 验证方式

```bash
grep SystemdCgroup /etc/containerd/config.toml
```

预期输出：`SystemdCgroup = true`，说明修改成功。

### 6.4 配置 Pause 镜像（国内环境推荐）

Pause 镜像是 Pod Sandbox 基础镜像，每个 Pod 启动前都会拉取，默认从 `registry.k8s.io` 拉取，国内网络可能失败，建议替换为阿里云镜像：

```bash
sed -i "s#sandbox = 'registry.k8s.io/pause:.*'#sandbox = 'registry.aliyuncs.com/google_containers/pause:3.10'#" /etc/containerd/config.toml
```

#### 验证方式

```bash
grep sandbox /etc/containerd/config.toml
```

预期输出包含 `registry.aliyuncs.com/google_containers/pause:3.10`，说明配置成功。

## 7. 配置 containerd 镜像加速（所有节点执行）

国内网络环境下，直接拉取 Docker Hub、K8s 官方镜像速度慢、易超时，需配置镜像加速，确保镜像拉取成功。

### 7.1 配置 Docker Hub 加速

使用毫秒镜像（`https://docker.1ms.run`）加速 Docker Hub 镜像拉取：

```bash
mkdir -p /etc/containerd/certs.d/docker.io
```

创建加速配置文件 `/etc/containerd/certs.d/docker.io/hosts.toml`，内容如下：

```toml
cat > /etc/containerd/certs.d/docker.io/hosts.toml <<'EOF'
server = "https://registry-1.docker.io"
[host."https://docker.1ms.run"]
  capabilities = ["pull", "resolve"]
[host."https://docker.1panel.live"]
  capabilities = ["pull", "resolve"]
[host."https://hub.rat.dev"]
  capabilities = ["pull", "resolve"]
[host."https://dockerproxy.net"]
  capabilities = ["pull", "resolve"]
[host."https://docker-registry.nmqu.com"]
  capabilities = ["pull", "resolve"]
EOF
```

#### 说明

毫秒镜像是国内专业的 Docker 镜像加速平台，下载速度可提升 10 倍以上，基础服务永久免费，稳定可靠。

### 7.2 配置 K8s 官方镜像仓库加速

K8s 官方镜像默认从 `registry.k8s.io` 拉取，配置阿里云镜像源加速：

```bash
mkdir -p /etc/containerd/certs.d/registry.k8s.io
```

创建加速配置文件 `/etc/containerd/certs.d/registry.k8s.io/hosts.toml`，内容如下：

```toml
cat > /etc/containerd/certs.d/registry.k8s.io/hosts.toml <<'EOF'
server = "https://registry.k8s.io"
[host."https://registry.cn-hangzhou.aliyuncs.com/google_containers"]
  capabilities = ["pull", "resolve"]
[host."https://k8s.m.daocloud.io"]
  capabilities = ["pull", "resolve"]
EOF
```

### 7.3 配置 quay.io 加速（可选）

若需拉取 quay.io 镜像（如 Prometheus、Grafana 等），可预先创建目录，后续按需添加加速配置：

```bash
mkdir -p /etc/containerd/certs.d/quay.io
```

创建加速配置文件 `/etc/containerd/certs.d/registry.k8s.io/hosts.toml`，内容如下：

```sh
cat > /etc/containerd/certs.d/quay.io/hosts.toml <<'EOF'
server = "https://quay.io"
[host."https://quay.nju.edu.cn"]
  capabilities = ["pull", "resolve"]
[host."https://quay.1ms.run"]
  capabilities = ["pull", "resolve"]
EOF
```

### 7.4 启用 certs.d 配置目录

修改 containerd 配置，告诉 containerd 从 `/etc/containerd/certs.d` 读取镜像加速配置，否则前面的加速配置不生效：

```bash
sed -i 's#config_path =.*#config_path = "/etc/containerd/certs.d"#' /etc/containerd/config.toml
```

#### 验证方式

```bash
grep config_path /etc/containerd/config.toml
```

预期输出：`config_path = "/etc/containerd/certs.d"`，说明启用成功。

### 7.5 重启 containerd 并设置开机自启

配置修改后，重启 containerd 使配置生效，并设置开机自启，确保服务器重启后正常运行：

```bash
systemctl daemon-reload
systemctl restart containerd
systemctl enable containerd
```

#### 验证方式

```bash
systemctl status containerd
```

预期状态为 `active (running)`，说明 containerd 启动成功。

## 8. 镜像拉取测试（所有节点执行）

镜像拉取是集群部署的关键前提，建议必须执行测试，确保各镜像仓库可正常拉取：

```bash
# 1. 定义版本（建议与 K8s 版本一致，如 v1.30.3）
VERSION="v1.34.6"
ARCH="amd64"

# 2. 下载并解压到 /usr/local/bin
curl -sL "https://github.com/kubernetes-sigs/cri-tools/releases/download/${VERSION}/crictl-${VERSION}-linux-${ARCH}.tar.gz" \
  | tar -xzf - -C /usr/local/bin

# 3. 验证
crictl --version

crictl pull registry.k8s.io/pause:3.10.1
crictl pull docker.io/library/nginx:alpine
crictl pull quay.io/prometheus/prometheus:v2.53.0
```

#### 说明

该测试分别验证以下 3 个常用镜像仓库的拉取能力，确保后续集群部署无镜像拉取问题：

- `registry.k8s.io`：K8s 官方镜像仓库
- `docker.io`：Docker Hub 官方仓库
- `quay.io`：常用开源组件镜像仓库

若拉取失败，通常原因：加速配置未生效、网络不通、DNS 异常、crictl 未配置运行时端点。

#### 补充 crictl 配置（可选）

若系统未配置 crictl，执行以下命令配置，确保 crictl 能正常连接 containerd：

```bash
cat <<EOF | tee /etc/crictl.yaml
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
debug: false
EOF
```

#### 验证方式

```bash
crictl info
```

若输出 containerd 相关信息，说明 crictl 配置成功。

## 9. 安装 Kubernetes 组件（所有节点执行）

安装 K8s 核心组件 kubelet、kubeadm、kubectl，三者版本需保持一致，避免兼容性问题。

### 9.1 安装依赖包

安装 HTTPS 软件源、密钥管理相关依赖，用于添加 K8s 官方软件源：

```bash
apt-get install -y apt-transport-https ca-certificates curl gpg
```

### 9.2 添加 K8s 官方软件源

添加 K8s 官方稳定版软件源，确保组件版本最新且稳定：

```bash
# 如果 `/etc/apt/keyrings` 目录不存在，则应在 curl 命令之前创建它，请阅读下面的注释。
# sudo mkdir -p -m 755 /etc/apt/keyrings
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.34/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

# 此操作会覆盖 /etc/apt/sources.list.d/kubernetes.list 中现存的所有配置。
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.34/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
```

#### 说明

该软件源为 K8s 官方新源，替代旧源，建议所有节点统一使用该源，避免版本不一致。

### 9.3 安装 kubelet、kubeadm、kubectl

```bash
apt-get update
apt-get install -y kubelet kubeadm kubectl
```

#### 组件说明

- `kubelet`：节点代理，运行在每个节点上，负责 Pod 生命周期管理、与 Master 节点通信。
- `kubeadm`：集群初始化工具，用于初始化 Master 节点、将 Node 节点加入集群。
- `kubectl`：K8s 命令行管理工具，用于操作集群、查看集群状态、管理资源。

### 9.4 锁定版本（关键）

锁定组件版本，防止系统自动升级导致 Master 与 Node 版本不一致、组件不兼容：

```bash
apt-mark hold kubelet kubeadm kubectl
```

### 9.5 启动 kubelet 并设置开机自启

```bash
systemctl enable --now kubelet
```

#### 说明

安装后 kubelet 可能处于“不断重启”状态，这是正常现象——因为此时尚未执行 `kubeadm init`，kubelet 未拿到集群配置。

#### 验证方式

```bash
systemctl status kubelet
```

只要 kubelet 处于“active”状态（即使重启），即说明启动成功。

## 10. 主机配置（所有节点执行）

配置主机名和 hosts 解析，确保节点之间可通过主机名互相访问，便于集群管理和通信。

### 10.1 设置主机名

根据节点角色，分别设置唯一的主机名（每台节点主机名不可重复）：

#### Master 节点

```bash
hostnamectl set-hostname k8smaster
hostnamectl set-hostname k8snode1
hostnamectl set-hostname k8snode2
hostnamectl set-hostname k8snode3
```

### 10.2 配置 hosts 解析

在所有节点执行以下命令，添加 hosts 解析（替换 IP 为实际节点 IP）：

```bash
cat >> /etc/hosts << EOF
10.135.40.150 k8smaster
10.135.40.151 k8snode1
10.135.40.152 k8snode2
10.135.40.153 k8snode3
EOF
```

#### 说明

若企业已有统一 DNS 服务器，且能解析所有节点主机名，可无需手工修改 `/etc/hosts`。

#### 验证方式

```bash
ping -c 1 k8smaster
ping -c 1 k8snode1
```

若 ping 能正常通，说明 hosts 解析配置成功。

## 11. 初始化 Master 节点（仅 Master 节点执行）

Master 节点是集群的控制平面，执行 `kubeadm init` 命令完成初始化，步骤如下：

```bash
kubeadm init \
  --apiserver-advertise-address=10.135.40.150 \
  --kubernetes-version v1.34.6 \
  --service-cidr=10.96.0.0/12 \
  --pod-network-cidr=10.244.0.0/16 \
  --image-repository registry.aliyuncs.com/google_containers \
  --cri-socket unix:///var/run/containerd/containerd.sock
```

### 11.1 参数说明

| 参数                                                         | 说明                                                         |
| :----------------------------------------------------------- | :----------------------------------------------------------- |
| `--apiserver-advertise-address=10.135.40.150`                | 指定 API Server 对外通告地址，填写 Master 节点实际 IP（不可用 localhost 或 127.0.0.1） |
| `--kubernetes-version v1.34.6`                               | 指定安装的 K8s 版本，与前面安装的 kubelet 版本一致           |
| `--service-cidr=10.96.0.0/12`                                | 指定 Service 网段，默认规划即可，无需修改                    |
| `--pod-network-cidr=10.244.0.0/16`                           | 指定 Pod 网段，必须与后续 Calico 插件配置的网段一致          |
| `--image-repository registry.aliyuncs.com/google_containers` | 使用阿里云镜像源，加速 K8s 基础镜像拉取（国内环境必加）      |
| `--cri-socket unix:///var/run/containerd/containerd.sock`    | 指定使用 containerd 作为容器运行时，与前面配置一致           |

### 11.2 初始化成功标志

初始化成功后，命令输出末尾会出现以下内容，说明 Master 节点初始化完成：

- 提示信息：`Your Kubernetes control-plane has initialized successfully!`
- 一段完整的 `kubeadm join` 命令（用于 Node 节点加入集群）

重要：请务必保存这段 `kubeadm join` 命令，后续 Node 节点加入集群时必须使用，丢失后需重新生成。

## 12. 配置 kubectl（仅 Master 节点执行）

Master 节点初始化完成后，需配置 kubectl 命令行工具，才能正常操作集群：

```bash
mkdir -p $HOME/.kube
cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
chown $(id -u):$(id -g) $HOME/.kube/config
```

#### 说明

`/etc/kubernetes/admin.conf` 是集群管理员配置文件，复制到当前用户目录后，kubectl 才能读取集群配置，实现集群管理。

#### 验证方式

```bash
kubectl get nodes
```

此时输出 Master 节点信息，但状态为`NotReady`，属于正常现象——因为尚未安装网络插件。

## 13. Node 节点加入集群（仅 Node 节点执行）

使用 Master 节点初始化完成后输出的 `kubeadm join` 命令，在每个 Node 节点分别执行，加入集群：

```bash
kubeadm join 10.135.40.150:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>
```

#### 说明

- `--token`：用于 Node 节点与 Master 节点认证，由 Master 初始化时自动生成。
- `--discovery-token-ca-cert-hash`：用于校验 API Server CA 证书指纹，确保通信安全。

#### 验证方式

在 Master 节点执行以下命令，查看 Node 节点是否成功加入：

```bash
kubectl get nodes
```

若能看到所有 Node 节点，但状态为 `NotReady`，说明节点已成功加入，等待安装网络插件后即可变为 `Ready`。

#### 补充：重新生成 join 命令

若丢失 join 命令，在 Master 节点执行以下命令重新生成：

```bash
kubeadm token create --print-join-command
```

## 14. 安装网络插件（Calico）（仅 Master 节点执行）

网络插件是 Pod 之间、Pod 与外部网络通信的核心，本文选用 Calico（主流、稳定、易用），版本为 v3.29.2。

### 14.1 安装 Calico Operator

Calico Operator 用于统一管理 Calico 组件，执行以下命令安装：

```bash
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.29.2/manifests/tigera-operator.yaml
```

### 14.2 下载自定义资源配置

```bash
wget https://raw.githubusercontent.com/projectcalico/calico/v3.29.2/manifests/custom-resources.yaml
```

### 14.3 修改 Pod 网段（关键）

编辑 `custom-resources.yaml` 文件，将其中的 Pod 网段修改为与 `kubeadm init` 中一致的 `10.244.0.0/16`：

```yaml
# 编辑文件
vim custom-resources.yaml

# 修改内容（找到以下配置，修改 cidr 值）
spec:
  calicoNetwork:
    ipPools:
    - blockSize: 26
      cidr: 10.244.0.0/16  # 必须与 --pod-network-cidr 一致
      encapsulation: VXLANCrossSubnet
      natOutgoing: Enabled
      nodeSelector: all()
```

#### 说明

Pod 网段必须与 `kubeadm init` 中的 `--pod-network-cidr=10.244.0.0/16` 完全一致，否则 Pod 网络无法正常通信。

### 14.4 应用配置

```bash
kubectl create -f custom-resources.yaml
```

### 14.5 查看 Calico 状态

执行以下命令，监控 Calico 组件启动状态，等待所有 Pod 进入 `Running` 状态：

```bash
watch kubectl get pod -n calico-system
```

#### 说明

Calico 组件启动需要 1-5 分钟，若 Pod 长时间未就绪，需检查：镜像拉取是否成功、节点网络是否正常、DNS 配置是否正确。

按`Ctrl + C` 可退出监控模式。

## 15. 集群安装完成验证

Calico 安装完成后，集群部署基本完成，执行以下验证步骤，确认集群正常可用：

### 15.1 查看节点状态

```bash
kubectl get nodes
```

#### 期望结果

所有节点（Master + Node）状态均为 `Ready`，示例如下：

```bash
NAME         STATUS   ROLES           AGE   VERSION
k8smaster    Ready    control-plane   10m   v1.34.6
k8snode1     Ready    <none>          5m    v1.34.6
k8snode2     Ready    <none>          5m    v1.34.6
k8snode3     Ready    <none>          5m    v1.34.6
```

### 15.2 查看系统 Pod 状态

```bash
kubectl get pod -A
```

#### 期望结果

- `kube-system` 命名空间下，所有核心 Pod（kube-apiserver、kube-controller-manager、kube-scheduler、etcd）均为 `Running`。
- `calico-system` 命名空间下，所有 Calico 相关 Pod 均为 `Running`。

### 15.3 查看集群信息

```bash
kubectl cluster-info
```

#### 期望结果

输出 API Server 地址、CoreDNS 地址等信息，说明集群控制平面正常运行。

### 15.4 测试 Pod 调度（可选）

创建一个测试 Pod，验证集群是否能正常调度和运行：

```bash
kubectl run test-pod --image=nginx:alpine
kubectl get pod

cat<<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: busybox
spec:
  containers:
  - name: busybox
    image: docker.m.daocloud.io/library/busybox:1.28
    command: ["sleep","3600"]
EOF

kubectl get po
NAME      READY   STATUS    RESTARTS   AGE
busybox   1/1     Running   0          3s

kubectl get svc
NAME         TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE
kubernetes   ClusterIP   10.96.0.1    <none>        443/TCP   23h

# 验证集群是否内部可通讯
kubectl exec busybox -n default -- nslookup kubernetes
Server:    10.96.0.10
Address 1: 10.96.0.10 kube-dns.kube-system.svc.cluster.local

Name:      kubernetes
Address 1: 10.96.0.1 kubernetes.default.svc.cluster.local
```

#### 期望结果

test-pod 状态为 `Running`，说明 Pod 调度正常，集群可正常使用。

删除测试 Pod：`kubectl delete pod busybox`


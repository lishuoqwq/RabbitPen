---
title: Kubernetes 集群安装 SOP（CentOS版本）
published: 2026-02-04
pinned: true
description: Kubernetes 集群安装 SOP（CentOS版本）
category: Linux
author: Bunny
image: https://picture.whgd.eu.org/file/1779264489816.png
---

# Kubernetes 集群安装 SOP（CentOS版本）

## 一、基础环境配置（所有节点执行）

### 1\.1 网卡与 Yum 源配置

```sh
# 1. 配置网卡（编辑网卡配置文件，根据实际网卡名/IP 修改）
vi /etc/sysconfig/network-scripts/ifcfg-eth0
# 网卡配置模板（替换IP/Gateway等为实际值）
TYPE="Ethernet"
PROXY_METHOD="none"
BROWSER_ONLY="no"
BOOTPROTO="none"
DEFROUTE="yes"
IPV4_FAILURE_FATAL="no"
IPV6INIT="yes"
IPV6_AUTOCONF="yes"
IPV6_DEFROUTE="yes"
IPV6_FAILURE_FATAL="no"
NAME="eth0"
IPV6_ADDR_GEN_MODE="stable-privacy"
UUID="82444210-33b1-4a9d-9790-60770794e17a"
DEVICE="eth0"
ONBOOT="yes"
IPADDR="10.135.40.152"  # Master节点IP，Node节点替换为10.135.40.153
PREFIX="24"
GATEWAY="10.135.40.254"
DNS1="114.114.114.114"
IPV6_PRIVACY="no"

# 2. 重启网卡生效
service network restart

# 3. 备份并替换 Yum 源为阿里云
cd /etc/yum.repos.d/
mkdir backup
mv CentOS-*.repo backup/
curl -o /etc/yum.repos.d/CentOS-Base.repo https://mirrors.aliyun.com/repo/Centos-7.repo

# 4. 清理缓存并生成新缓存
yum clean all && yum makecache

# 5. 可选：安装 EPEL 扩展源
yum install -y epel-release
```

### 1\.2 基础服务配置

```sh
# 1. 安装并配置 SSH（优化连接问题）
yum install -y openssh-server
systemctl start sshd && systemctl enable sshd
sed -i 's/^#UseDNS yes/UseDNS no/' /etc/ssh/sshd_config
sed -i 's/^GSSAPIAuthentication yes/GSSAPIAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd

# 2. 永久禁用防火墙
systemctl stop firewalld && systemctl disable firewalld

# 3. 关闭 SELinux
setenforce 0
sed -i 's/enforcing/disabled/' /etc/selinux/config

# 4. 关闭 Swap（K8s 强制要求）
swapoff -a
sed -ri 's/.*swap.*/#&/' /etc/fstab

# 5. 设置主机名与 hosts 解析
# Master 节点
hostnamectl set-hostname k8smaster
# Node 节点
hostnamectl set-hostname k8snode1

# 所有节点配置 hosts
cat >> /etc/hosts << EOF
10.135.40.152 k8smaster
10.135.40.153 k8snode1
EOF
```

### 1\.3 内核参数与网络转发配置

```sh
# 1. 加载内核模块
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
sudo modprobe overlay
sudo modprobe br_netfilter

# 2. 设置内核参数（转发/桥接）
cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

# 3. 生效配置
sudo sysctl --system
```

## 二、安装 Containerd 运行时（所有节点执行）

```sh
# 1. 配置阿里云 Docker 源
yum-config-manager --add-repo http://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo
yum clean all && yum makecache

# 2. 安装 Containerd
yum install -y containerd.io

# 3. 生成并修改 Containerd 配置
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml

# 启用 SystemdCgroup（K8s 要求）
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
# 替换 pause 镜像为阿里云源
sed -i 's|sandbox_image = "registry.k8s.io/pause:3.6"|sandbox_image = "registry.aliyuncs.com/google_containers/pause:3.9"|' /etc/containerd/config.toml

# 4. 配置容器镜像加速（适配国内网络）
# Docker Hub 加速
mkdir -p /etc/containerd/certs.d/docker.io
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

# K8s 镜像加速
mkdir -p /etc/containerd/certs.d/registry.k8s.io
cat > /etc/containerd/certs.d/registry.k8s.io/hosts.toml <<'EOF'
server = "https://registry.k8s.io"
[host."https://registry.cn-hangzhou.aliyuncs.com/google_containers"]
  capabilities = ["pull", "resolve"]
[host."https://k8s.m.daocloud.io"]
  capabilities = ["pull", "resolve"]
EOF

# Quay.io 镜像加速
mkdir -p /etc/containerd/certs.d/quay.io
cat > /etc/containerd/certs.d/quay.io/hosts.toml <<'EOF'
server = "https://quay.io"
[host."https://quay.nju.edu.cn"]
  capabilities = ["pull", "resolve"]
[host."https://quay.1ms.run"]
  capabilities = ["pull", "resolve"]
EOF

# 5. 生效配置并重启 Containerd
sed -i 's#config_path =.*#config_path = "/etc/containerd/certs.d"#' /etc/containerd/config.toml
systemctl daemon-reload
systemctl restart containerd
systemctl enable containerd

# 6. 安装 crictl 工具（验证 Containerd）
VERSION="v1.30.0"
ARCH="amd64"
curl -sL https://ghproxy.net/https://github.com/kubernetes-sigs/cri-tools/releases/download/${VERSION}/crictl-${VERSION}-linux-${ARCH}.tar.gz | tar -xzf - -C /usr/local/bin

# 配置 crictl
cat <<EOF | tee /etc/crictl.yaml
runtime-endpoint: unix:///run/containerd/containerd.sock
image-endpoint: unix:///run/containerd/containerd.sock
timeout: 10
debug: false
EOF

# 7. 验证 Containerd 可用性
crictl info
# 验证镜像拉取（可选）
crictl pull registry.k8s.io/pause:3.10.1
crictl pull docker.io/library/nginx:alpine
crictl pull quay.io/prometheus/prometheus:v2.53.0
```

## 三、安装 K8s 组件（所有节点执行）

```sh
# 1. 配置阿里云 K8s Yum 源
cat <<EOF > /etc/yum.repos.d/kubernetes.repo
[kubernetes]
name=Kubernetes
baseurl=https://mirrors.aliyun.com/kubernetes/yum/repos/kubernetes-el7-x86_64/
enabled=1
gpgcheck=0
EOF

# 2. 安装 K8s 组件（推荐 1.28.x 版本）
yum install -y kubelet kubeadm kubectl
systemctl enable kubelet
```

## 四、部署 K8s 集群

### 4\.1 初始化 Master 节点（仅 Master 执行）

```sh
kubeadm init \
   --apiserver-advertise-address=10.135.40.152 \  # Master 节点 IP
   --image-repository registry.aliyuncs.com/google_containers \  # 阿里云镜像源
   --kubernetes-version v1.28.2 \  # K8s 版本
   --service-cidr=10.96.0.0/12 \  # 服务网段
   --pod-network-cidr=10.244.0.0/16  # Pod 网段（需与网络插件一致）

# 配置 kubectl 权限（普通用户）
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

### 4\.2 Node 节点加入集群（仅 Node 执行）

```sh
# 替换 <你的TOKEN> 和 <你的HASH> 为 Master 初始化后输出的内容
kubeadm join 10.135.40.152:6443 --token <你的TOKEN> \
    --discovery-token-ca-cert-hash sha256:<你的HASH>
```

### 4\.3 安装 Calico 网络插件（仅 Master 执行）

```sh
# 下载 Calico 配置文件
curl https://raw.githubusercontent.com/projectcalico/calico/v3.26.1/manifests/calico.yaml -O

# 修改 Pod 网段（与 init 时的 pod-network-cidr 一致）
sed -i '/^[[:space:]]*# - name: CALICO_IPV4POOL_CIDR/c\            - name: CALICO_IPV4POOL_CIDR' calico.yaml
sed -i '/^[[:space:]]*#   value: "192.168.0.0\/16"/c\              value: "10.244.0.0\/16"' calico.yaml

# 应用配置
kubectl apply -f calico.yaml

# 验证集群状态
kubectl get pods -n kube-system  # 所有 Pod 状态为 Running 则正常
kubectl get nodes  # 所有节点状态为 Ready 则正常
```

## 五、关键验证命令

|操作|命令|
|---|---|
|检查节点状态|kubectl get nodes|
|检查系统组件 Pod|kubectl get pods \-n kube\-system|
|检查 Containerd 状态|systemctl status containerd|
|检查 Kubelet 状态|systemctl status kubelet|
|验证镜像拉取|crictl pull [registry\.aliyuncs\.com/google\_containers/pause:3\.9](https://registry.aliyuncs.com/google_containers/pause:3.9)|

## 六、注意事项

1. 所有操作建议以 root 用户执行，避免权限问题；

2. 确保节点间网络互通（6443、8472 等端口需放行）；

3. 生产环境建议关闭 root 直接 SSH 登录，改用普通用户 \+ sudo；

4. 若镜像拉取失败，检查 Containerd 镜像加速配置是否生效；

5. K8s 版本与 Calico 版本需兼容（推荐 Calico v3\.26\+ 适配 K8s 1\.28\+）。

---
title: K8s 高可用集群搭建
published: 2026-03-20
pinned: true
description: K8s 高可用集群搭建
tags: [K8S]
slug: K8S
category: K8S
author: Bunny
draft: false
date: 2026-03-20
image: [https://picture.whgd.eu.org/file/1737613131026_【哲风壁纸】笑嘻嘻-美女.png](https://picture.whgd.eu.org/file/1773983120958_【哲风壁纸】卡通动物-卡通猫.png)
pubDate: 2026-03-20
---

##### 1、本地安装Ollama，下载两个模型
# 🚀 Ubuntu 三节点 K8s 高可用集群搭建 SOP

## 📑 节点规划

| 角色       | 主机名      | IP 示例       | 硬件建议 |
| ---------- | ----------- | ------------- | -------- |
| 控制节点   | `k8smaster` | 10.135.40.150 | 4C 8G    |
| 工作节点 1 | `k8snode1`  | 10.135.40.151 | 8C 16G   |
| 工作节点 2 | `k8snode2`  | 10.135.40.152 | 8C 16G   |

## 🛠️ 第一阶段：系统基础环境配置（所有 3 台机器执行）

在安装 K8s 之前，必须先将 Linux 宿主机的环境调教到最佳状态。

#### 1.设置主机名与 Host 解析

```sh
# 在各自机器上分别设置主机名（以 master 为例）
sudo hostnamectl set-hostname k8smaster

# 在所有机器的 /etc/hosts 追加以下内容，打通内网解析
cat <<EOF | sudo tee -a /etc/hosts
10.135.40.150 k8smaster
10.135.40.151 k8snode1
10.135.40.152 k8snode2
EOF
```

#### 2.关闭 Swap 交换分区（K8s 强依赖）

```sh
sudo swapoff -a
sudo sed -i '/ swap / s/^\(.*\)$/#\1/g' /etc/fstab

# ubuntu系统
# 1. 在 fstab 中注释掉 swap 行
vim /etc/fstab
# /swap.img       none    swap    sw      0       0

# 2. 删除 swap 文件释放空间
rm /swap.img

# 3.验证 swap 已关闭
free -h
swapon --show
cat /proc/swaps
```

#### 3.配置内核路由转发与网桥过滤

```sh
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter

cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sudo sysctl --system
```

## 🐳 第二阶段：安装容器运行时与 K8s 组件（所有 3 台机器执行）

#### 1.安装 Docker Engine 容器引擎

```sh
sudo apt-get update
sudo apt-get install -y docker.io

# 配置 Docker 使用 systemd 作为 cgroup 驱动（K8s 推荐规范）
cat <<EOF | sudo tee /etc/docker/daemon.json
{
  "exec-opts": ["native.cgroupdriver=systemd"],
  "insecure-registries": ["kubernetes-register.sswang.com"],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m"
  },
  "storage-driver": "overlay2",
  "registry-mirrors": [  
    "https://docker.1ms.run",  
    "https://doublezonline.cloud",  
    "https://dislabaiot.xyz",  
    "https://docker.fxxk.dedyn.io",  
    "https://dockerpull.org",  
    "https://docker.unsee.tech",  
    "https://hub.rat.dev",  
    "https://docker.1panel.live",  
    "https://docker.nastool.de",  
    "https://docker.zhai.cm",  
    "https://docker.5z5f.com",  
    "https://a.ussh.net",  
    "https://docker.udayun.com",  
    "https://hub.geekery.cn"  
  ]
}
EOF

sudo systemctl enable docker
sudo systemctl daemon-reload
sudo systemctl restart docker
```

#### 2.安装 `cri-dockerd`（让 K8s 认出 Docker 的关键）

```sh
# 下载对应的 deb 安装包 (以 v0.3.4 为例)
wget https://github.com/Mirantis/cri-dockerd/releases/download/v0.3.16/cri-dockerd_0.3.16.3-0.ubuntu-jammy_amd64.deb

# 安装
sudo dpkg -i cri-dockerd_0.3.16.3-0.ubuntu-jammy_amd64.deb

# 修改 cri-dockerd 的配置，指定国内镜像加速
sed -i -e 's|ExecStart=.*|ExecStart=/usr/bin/cri-dockerd --container-runtime-endpoint fd:// --network-plugin=cni --pod-infra-container-image=registry.aliyuncs.com/google_containers/pause:3.9|g' /lib/systemd/system/cri-docker.service

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable cri-docker.service
sudo systemctl start cri-docker.service
```

#### 3.安装 Kubeadm, Kubelet 和 Kubectl（使用阿里云镜像加速）

```sh
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl

# 下载阿里云 GPG 密钥
curl -fsSL https://mirrors.aliyun.com/kubernetes/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-archive-keyring.gpg

# 添加阿里云 K8s 软件源
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-archive-keyring.gpg] https://mirrors.aliyun.com/kubernetes/apt/ kubernetes-xenial main" | sudo tee /etc/apt/sources.list.d/kubernetes.list

# 安装组件（锁定版本防止意外升级）
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl

# 配置kubelet（进入文件kubelet，1.30版本之后都是在 /etc/default/kubelet配置）
vim /etc/default/kubelet
KUBELET_EXTRA_ARGS="--cgroup-driver=systemd"
systemctl enable kubelet

```

## 👑 第三阶段：初始化 Master 节点（仅在 k8smaster 执行）

#### 1.在 Master 节点上执行初始化。
**注意：因为我们用的是 Docker，必须通过 `--cri-socket` 明确告诉 K8s 去找 `cri-dockerd`！**

```sh
# 执行初始化
sudo kubeadm init \
  --kubernetes-version=1.32.13  \ 
  --control-plane-endpoint=k8smaster  \
  --apiserver-advertise-address=10.135.40.150 <master节点IP> \
  --image-repository registry.aliyuncs.com/google_containers \
  --pod-network-cidr=10.244.0.0/16 \
  --service-cidr=10.96.0.0/12  \ 
  --cri-socket unix:///var/run/cri-dockerd.sock  \
  --upload-certs  \  
  --v=9
```

##### 根据自己的ip设置好参数后，在master！注意是master节点，上执行`kubeadm init`命令。可能会需要一两分钟下载镜像，执行完毕后输出如下：

```sh
规划pod/service网段，这两个网段和宿主机网段不能重复！原则只有一个：三个网段不重复，没有交叉即可！

- 宿主机网段：前面已经规划过。即：192.168.31.0/24
- service网段：10.96.0.0/12
- pod网段：10.244.0.0/16

kubernetes-version：指定k8s的版本，我这里是1.32.2，你的也许是1.31.1-1.1等
control-plane-endpoint：可以理解为集群master的命名，随意写即可
apiserver-advertise-address：集群中master的地址！注意不要抄，写你自己虚拟机的ip地址
pod-network-cidr：pod网段地址
service-cidr：service网段地址
image-repository：指定使用国内镜像
cri-socket：指定使用的容器运行时，如果你使用的containerd容器，那就不用写这个参数
v：日志级别，9表示输出的信息会很详细
```

#### 2.**初始化成功后，配置普通用户的 kubectl 权限：**

```sh
mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

##### ⚠️ **保存终端最后输出的 `kubeadm join ...` 命令，下一步要用！**

#### 3.安装网络插件（👑 仅 k8s master 执行）

##### K8s 需要网络插件才能让 Pod 互相通信。这里使用最简单稳定的 **calico**。

```sh
wget  https://raw.githubusercontent.com/projectcalico/calico/v3.29.2/manifests/custom-resources.yaml

vim custom-resources.yaml

# This section includes base Calico installation configuration.
# For more information, see: https://docs.tigera.io/calico/latest/reference/installation/api#operator.tigera.io/v1.Installation
apiVersion: operator.tigera.io/v1
kind: Installation
metadata:
  name: default
spec:
  # Configures Calico networking.
  calicoNetwork:
    ipPools:
    - name: default-ipv4-ippool
      blockSize: 26
      cidr: 10.244.0.0/16（修改其中的网段为之前规划好的pod网段10.244.0.0/16）
      encapsulation: VXLANCrossSubnet
      natOutgoing: Enabled
      nodeSelector: all()

---

# This section configures the Calico API server.
# For more information, see: https://docs.tigera.io/calico/latest/reference/installation/api#operator.tigera.io/v1.APIServer
apiVersion: operator.tigera.io/v1
kind: APIServer
metadata:
  name: default
spec: {}

# 运行calico
kubectl create -f custom-resources.yaml
```

## 🤝 第四阶段：Node 节点加入集群（仅在 node1, node2 执行）

#### 1.把刚才 Master 节点初始化成功后输出的 `kubeadm join` 命令复制到两个 Node 节点执行。

##### 核心注意：命令末尾必须加上 `--cri-socket`！

```sh
# 示例（请替换为你自己的 token 和 hash）：
sudo kubeadm join k8smaster:6443 \
  --token 3xgw7j.9o7d4051pfteeb0t \
  --discovery-token-ca-cert-hash sha256:fc3fd63d42581d6c31be38026b6ff5f82278c723cfc0a572b239647fe3633e58 \
  --cri-socket unix:///var/run/cri-dockerd.sock
```

#### 2.验证集群状态（👑 仅 k8smaster 执行）

##### 在 Master 节点上查看集群是否搭建成功

```sh
# 查看节点状态（大约 1-2 分钟后，所有节点应该变成 Ready）
kubectl get nodes -o wide

# 查看系统核心 Pod 是否都在 Running 状态
kubectl get pods -n kube-system -o wide
```

#### 3、想给现在的集群“加一台新机器（加一个 Node 节点）

##### 在 Master 节点上重新生成加入口令

```sh
kubeadm token create --print-join-command
# 屏幕上会输出一串类似 `kubeadm join 192.168.1.10:6443 --token xyz...` 的命令
新节点加入集群
复制刚才在 Master 节点上生成的那串命令，拿到 新机器（k8snode3） 上执行。
⚠️ 极其重要：千万别忘了在末尾加上 cri-dockerd 的尾巴！
```


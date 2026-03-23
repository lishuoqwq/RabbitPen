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
image: https://picture.whgd.eu.org/file/1773983120958_【哲风壁纸】卡通动物-卡通猫.png
pubDate: 2026-03-20
---

# 🚀 Ubuntu 三节点 K8s 高可用集群搭建 SOP

## 📑 节点规划

| 角色       | 主机名      | IP 示例       | 硬件建议 |
| ---------- | ----------- | ------------- | -------- |
| 控制节点   | `k8smaster` | 10.135.40.150 | 4C 8G    |
| 工作节点 1 | `k8snode1`  | 10.135.40.151 | 8C 16G   |
| 工作节点 2 | `k8snode2`  | 10.135.40.152 | 8C 16G   |
| 工作节点 3 | `k8snode3`  | 10.135.40.153 | 8C 16G   |

## 🛠️ 第一阶段：系统基础环境配置（所有 3 台机器执行）

在安装 K8s 之前，必须先将 Linux 宿主机的环境调教到最佳状态。

#### 1.设置主机名与 Host 解析

```sh
# 在各自机器上分别设置主机名（以 master 为例）
sudo hostnamectl set-hostname k8smaster
sudo hostnamectl set-hostname k8snode1
sudo hostnamectl set-hostname k8snode2
sudo hostnamectl set-hostname k8snode3

# 在所有机器的 /etc/hosts 追加以下内容，打通内网解析
cat <<EOF | sudo tee -a /etc/hosts
10.135.40.150 k8smaster
10.135.40.151 k8snode1
10.135.40.152 k8snode2
10.135.40.153 k8snode3
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
cat << EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-ip6tables = 1
net.bridge.bridge-nf-call-iptables = 1
net.ipv4.ip_forward = 1
EOF

sudo modprobe overlay
sudo modprobe br_netfilter

cat << EOF | tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sudo sysctl --system

apt install -y ipset ipvsadm

cat << EOF | tee /etc/modules-load.d/ipvs.conf
ip_vs
ip_vs_rr
ip_VS_wrr
ip_vs_sh
nf_conntrack
EOF

cat << EOF | tee ipvs.sh
#!/bin/sh
modprobe -- ip_vs
modprobe -- ip_vs_rr
modprobe -- ip_vs_wrr
modprobe -- ip_vs_sh
modprobe -- nf_conntrack
EOF

# 验证脚本是否生效
sh ipvs.sh
lsmod | grep ip_vs
```

#### 4.配置时间同步

```sh
timedatectl set-timezone Asia/Shanghai

# 安装ntpdate并与阿里云同步
apt install -y ntpsec-ntpdate
ntpdate ntp.aliyun.com

# 配置自动同步
crontab -e
0 0 * * * ntpdate ntp.aliyun.com
```



## 🐳 第二阶段：安装容器运行时与 K8s 组件（所有 3 台机器执行）

#### 1.安装 Docker Engine 容器引擎

```sh
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

# 安装最新版docker
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 使用 docker --version 检查


# 配置 Docker 使用 systemd 作为 cgroup 驱动（K8s 推荐规范）
cat <<EOF | sudo tee /etc/docker/daemon.json
{  
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
  ],
  "insecure-registries": ["kubernetes-register.sswang.com"],
  "exec-opts": [  
    "native.cgroupdriver=systemd"  
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

# 解压
tar xf cri-dockerd-0.3.16.amd64.tgz
cp -r cri-dockerd/cri-dockerd /usr/local/bin/
cp -r cri-dockerd/cri-dockerd /usr/bin/

# 查看版本号
cri-dockerd --version

# 设置开机启动脚本，创建文件 /etc/systemd/system/cri-dockerd.service ，写入如下内容（完全复制即可）
cat > /etc/systemd/system/cri-dockerd.service<<-EOF
[Unit]
Description=CRI Interface for Docker Application Container Engine
Documentation=https://docs.mirantis.com
After=network-online.target firewalld.service docker.service
Wants=network-online.target
Requires=cri-docker.socket     #system cri-docker.socket  文件名
 
[Service]
Type=notify
ExecStart=/usr/local/bin/cri-dockerd --pod-infra-container-image=registry.cn-hangzhou.aliyuncs.com/google_containers/pause:3.10
 --network-plugin=cni --cni-conf-dir=/etc/cni/net.d --cni-bin-dir=/opt/cni/bin --container-runtime-endpoint=unix:///var/run/cri-dockerd.sock --cri-dockerd-root-directory=/var/lib/dockershim --docker-endpoint=unix:///var/run/docker.sock --cri-dockerd-root-directory=/var/lib/docker
ExecReload=/bin/kill -s HUP $MAINPID
TimeoutSec=0
RestartSec=2
Restart=always
StartLimitBurst=3
StartLimitInterval=60s
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
TasksMax=infinity
Delegate=yes
KillMode=process
[Install]
WantedBy=multi-user.target
EOF

# 创建 /etc/systemd/system/cri-docker.socket 文件，并写入如下内容
cat > /etc/systemd/system/cri-docker.socket <<-EOF
[Unit]
Description=CRI Docker Socket for the API
PartOf=cri-docker.service    #systemd cri-docker.servics 文件名
 
[Socket]
ListenStream=/var/run/cri-dockerd.sock
SocketMode=0660
SocketUser=root
SocketGroup=docker
 
[Install]
WantedBy=sockets.target
EOF

# 启动服务
sudo systemctl daemon-reload
sudo systemctl enable cri-docker.service
sudo systemctl start cri-docker.service

# 验证启动信息
root@master:/opt# ls  /var/run | grep docker
cri-dockerd.sock
docker
docker.pid
docker.sock
```

#### 3.安装 Kubeadm, Kubelet 和 Kubectl（使用阿里云镜像加速）

```sh
sudo apt-get update
sudo apt-get install -y apt-transport-https ca-certificates curl gpg

# 下载阿里云 GPG 密钥（二选一）
1、curl -fsSL https://mirrors.aliyun.com/kubernetes/apt/doc/apt-key.gpg | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-archive-keyring.gpg
2、curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.32/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg


# 添加阿里云 K8s 软件源
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-archive-keyring.gpg] https://mirrors.aliyun.com/kubernetes/apt/ kubernetes-xenial main" | sudo tee /etc/apt/sources.list.d/kubernetes.list

# 安装组件（锁定版本防止意外升级）
sudo apt-get update
sudo apt-cache policy kubeadm
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
--kubernetes-version=1.32.13 \
--control-plane-endpoint=k8smaster \
--apiserver-advertise-address=10.135.40.150 \
--image-repository registry.aliyuncs.com/google_containers \
--pod-network-cidr=10.244.0.0/16 \
--service-cidr=10.96.0.0/12 \
--cri-socket unix:///var/run/cri-dockerd.sock \
--upload-certs \
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
# master节点上安装官方插件
kubectl create -f https://raw.githubusercontent.com/projectcalico/calico/v3.29.2/manifests/tigera-operator.yaml

# 下载配置文件
wget  https://raw.githubusercontent.com/projectcalico/calico/v3.29.2/manifests/custom-resources.yaml

# 修改配置文件
vim custom-resources.yaml
cidr: 10.244.0.0/16（修改其中的网段为之前规划好的pod网段10.244.0.0/16）

# 运行calico
kubectl create -f custom-resources.yaml

# 使用watch命令可以持续监视pod状态
watch kubectl get pod -n calico-system

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


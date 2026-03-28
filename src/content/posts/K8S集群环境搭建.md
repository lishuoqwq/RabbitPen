---
title: K8s 高可用集群搭建
published: 2026-03-20
pinned: true
description: K8s 高可用集群搭建
tags: [k8s,集群搭建,高可用]
category: Linux
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

## 🐉 第五阶段：安装 Longhorn

#### 1、环境准备（在【所有 4 个节点】上执行）

##### Longhorn 需要底层操作系统支持 `iSCSI`（用于提供块存储）和 `NFS`（用于提供多读多写存储）。

```sh
# 1. 更新系统的软件源列表（相当于刷新应用商店）
sudo apt-get update

# 2. 安装 open-iscsi（Longhorn 核心依赖）和 nfs-common（用于支持多节点共享挂载）
sudo apt-get install open-iscsi nfs-common -y

# 3. 启动 iscsid 服务，并设置为开机自启
sudo systemctl enable --now iscsid
```

#### 2、检查环境（在【Master 节点】执行）

##### Longhorn 官方提供了一个检测脚本，用来帮你检查刚才的环境有没有准备好。

```sh
# 下载并运行 Longhorn 的环境检查脚本，依赖了 bash 和 jq（如果没有 jq 可能会报错，但如果不报错就说明没问题）
curl -sSfL https://raw.githubusercontent.com/longhorn/longhorn/v1.6.0/scripts/environment_check.sh | bash
```

##### *作用*：如果输出结果中所有的 `Status` 都是 `True` 或者没有报明显的红色 `Error`，就可以放心进行下一步了。

```sh
# 实时查看 longhorn-system 命名空间下所有 Pod（容器）的运行状态
kubectl get pods -n longhorn-system -w
```

##### *作用*：`-w` 表示实时监控。你会看到很多组件正在 `ContainerCreating`（拉取镜像创建中）。请耐心等待几分钟，直到所有的 Pod 的状态（STATUS）都变成 **`Running`**。 *(看到全部 Running 后，按 `Ctrl + C` 退出监控)*。

#### 4、暴露并访问 Longhorn 可视化界面（在【Master 节点】执行）

##### Longhorn 自带一个非常漂亮的 Web 界面，但默认情况下它只在集群内部可以访问。我们需要把它暴露出来。对于小白来说，最简单的方法是改成 `NodePort` 模式。

```sh
# 1. 修改 UI 服务的类型，从默认的 ClusterIP 改为 NodePort（暴露到主机的物理端口上）
kubectl patch svc longhorn-frontend -n longhorn-system -p '{"spec": {"type": "NodePort"}}'

# 2. 查看系统为你分配了哪个物理端口
kubectl get svc longhorn-frontend -n longhorn-system

# 3. 修改默认分配的端口
kubectl patch svc longhorn-frontend -n longhorn-system --type='json' -p='[{"op": "replace", "path": "/spec/ports/0/nodePort", "value": 30880}]'
```

##### *作用*：执行完第二条命令后，你会看到类似这样的输出： `longhorn-frontend NodePort 10.97.x.x <none> 80:30880/TCP`

##### 请注意看 `80:` 后面的那个五位数（例如上面的 **30880**），这就是你的访问端口。

##### **如何访问：** 打开你的电脑浏览器，输入： `http://<任意一个节点的IP地址>:<刚刚查到的五位数端口>` （例如：`http://10.135.40.150:30880`） 你就能看到 Longhorn 的管理界面了！

#### 5、将 Longhorn 设置为集群的默认存储（在【Master 节点】执行）

##### 为了以后你创建 MySQL、Redis 等需要持久化数据的应用时，Kubernetes 能自动帮你向 Longhorn 要硬盘，我们需要把它设为默认存储。

```sh
# 给 Longhorn 的 StorageClass 打上“默认”的标记
kubectl patch storageclass longhorn -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'

# 查看是否设置成功
kubectl get sc
```

##### *作用*：执行第二条命令后，如果你看到 `longhorn (default)` 字样，说明大功告成！

## 🎉 第六阶段：Docker卷目录迁移至K8S集群

#### 1、在【旧 Docker 服务器】打包老数据

##### 假设你以前 Docker 跑的时候，宿主机上存数据的目录是 `/opt/data/postgres` 和 `/opt/data/minio`

```sh
# 1. 进入数据所在的父目录
cd /opt/data

# 3. 把包传到你的 K8s Master 节点
scp /opt/data root@<新K8s_Master的IP>:/opt/teable_data
```

#### 2、在 K8s 部署并“断电”

##### 我们要先让 K8s 按照你的 YAML 把 Longhorn 硬盘全自动建出来。

```yaml
---
# ==========================================
# 1. 基础配置层 (保持不变)
# ==========================================
apiVersion: v1
kind: ConfigMap
metadata:
  name: teable-config
  namespace: teable
data:
  PUBLIC_ORIGIN: "http://10.135.40.150:30000"
  
  # MinIO 存储配置（内外网分离架构）
  BACKEND_STORAGE_PROVIDER: "minio"
  BACKEND_STORAGE_PUBLIC_BUCKET: "teable-pub"
  BACKEND_STORAGE_PRIVATE_BUCKET: "teable-pvt"
  BACKEND_STORAGE_MINIO_USE_SSL: "false"
  
  # 【外部地址】：前端浏览器下载、预览附件时使用的地址
  BACKEND_STORAGE_MINIO_ENDPOINT: "10.135.40.150"
  BACKEND_STORAGE_MINIO_PORT: "32000"
  STORAGE_PREFIX: "http://10.135.40.150:32000"
  
  # 【内部地址】：Teable后端容器上传、读写附件时直连的 K8s 内网地址（极速）
  BACKEND_STORAGE_MINIO_INTERNAL_ENDPOINT: "minio.teable.svc.cluster.local"
  BACKEND_STORAGE_MINIO_INTERNAL_PORT: "9000"
  
  BACKEND_CACHE_PROVIDER: "redis"
  NEXT_ENV_IMAGES_ALL_REMOTE: "true"
  PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: "1"
---
apiVersion: v1
kind: Secret
metadata:
  name: teable-secrets
  namespace: teable
type: Opaque
stringData:
  PRISMA_DATABASE_URL: "postgresql://teable:teable@postgres.teable.svc.cluster.local:5432/teable"
  BACKEND_CACHE_REDIS_URI: "redis://@redis.teable.svc.cluster.local:6379/0"
  BACKEND_JWT_SECRET: "teable-random-jwt-secret-abc123"
  BACKEND_SESSION_SECRET: "teable-random-session-secret-xyz890"
  BACKEND_STORAGE_MINIO_ACCESS_KEY: "root"
  BACKEND_STORAGE_MINIO_SECRET_KEY: "P@ssw0rd"

---
# ==========================================
# 2. 数据库层 (PostgreSQL - 升级为 StatefulSet + Longhorn)
# ==========================================
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: teable
spec:
  serviceName: "postgres"
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
        - name: postgres
          image: registry.cn-shenzhen.aliyuncs.com/teable/postgres:15.4
          env:
            - name: POSTGRES_DB
              value: teable
            - name: POSTGRES_USER
              value: teable
            - name: POSTGRES_PASSWORD
              value: teable
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          ports:
            - containerPort: 5432
          volumeMounts:
            - name: pg-data
              mountPath: /var/lib/postgresql/data
  # 【核心机制】：向 Longhorn 动态申请 10G 虚拟网络磁盘
  volumeClaimTemplates:
    - metadata:
        name: pg-data
      spec:
        accessModes: [ "ReadWriteOnce" ]
        storageClassName: "longhorn"
        resources:
          requests:
            storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: teable
spec:
  selector:
    app: postgres
  ports:
    - port: 5432

---
# ==========================================
# 3. 缓存层 (Redis - 升级为 StatefulSet + Longhorn)
# ==========================================
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: redis
  namespace: teable
spec:
  serviceName: "redis"
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
        - name: redis
          image: registry.cn-shenzhen.aliyuncs.com/teable/redis:7.2.4
          args: ["redis-server", "--appendonly", "yes"]
          ports:
            - containerPort: 6379
          volumeMounts:
            - name: redis-data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: redis-data
      spec:
        accessModes: [ "ReadWriteOnce" ]
        storageClassName: "longhorn"
        resources:
          requests:
            storage: 1Gi
---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: teable
spec:
  selector:
    app: redis
  ports:
    - port: 6379

---
# ==========================================
# 4. 对象存储层 (MinIO - 升级为 StatefulSet + Longhorn)
# ==========================================
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: minio
  namespace: teable
spec:
  serviceName: "minio"
  replicas: 1
  selector:
    matchLabels:
      app: minio
  template:
    metadata:
      labels:
        app: minio
    spec:
      containers:
        - name: minio
          image: registry.cn-shenzhen.aliyuncs.com/teable/minio:RELEASE.2024-10-13T13-34-11Z-cpuv1
          args:
            - server
            - /data
            - --console-address
            - ":9001"
          env:
            - name: MINIO_ROOT_USER
              value: root
            - name: MINIO_ROOT_PASSWORD
              value: P@ssw0rd
          ports:
            - containerPort: 9000
            - containerPort: 9001
          volumeMounts:
            - name: minio-data
              mountPath: /data
  volumeClaimTemplates:
    - metadata:
        name: minio-data
      spec:
        accessModes: [ "ReadWriteOnce" ]
        storageClassName: "longhorn"
        resources:
          requests:
            storage: 10Gi
---
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: teable
spec:
  type: NodePort
  selector:
    app: minio
  ports:
    - port: 9000
      targetPort: 9000
      nodePort: 32000
      name: api
    - port: 9001
      targetPort: 9001
      nodePort: 32001
      name: console
---
apiVersion: batch/v1
kind: Job
metadata:
  name: minio-setup
  namespace: teable
spec:
  template:
    spec:
      containers:
      - name: minio-mc
        image: minio/mc:RELEASE.2022-12-13T00-23-28Z
        command:
        - /bin/sh
        - -c
        - |
          echo "等待 MinIO..."
          until mc alias set teable-minio http://minio:9000 root P@ssw0rd; do sleep 3; done
          mc mb --ignore-existing teable-minio/teable-pub
          mc mb --ignore-existing teable-minio/teable-pvt
          mc anonymous set public teable-minio/teable-pub
          echo "初始化完成！"
      restartPolicy: OnFailure

---
# ==========================================
# 5. 应用层 (Teable 主程序 - 目前保持 1 副本用于导数据)
# ==========================================
apiVersion: apps/v1
kind: Deployment
metadata:
  name: teable
  namespace: teable
spec:
  replicas: 1  # 稍后数据导入完毕，我们再横向扩容到 2
  selector:
    matchLabels:
      app: teable
  template:
    metadata:
      labels:
        app: teable
    spec:
      # 【核心新增】：反亲和性，如果有多副本，强制打散到不同物理机
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - teable
            topologyKey: "kubernetes.io/hostname"
      initContainers:
        - name: db-migrate
          image: registry.cn-shenzhen.aliyuncs.com/teable/teable:latest
          args: ["migrate-only"]
          envFrom:
            - configMapRef:
                name: teable-config
            - secretRef:
                name: teable-secrets
      containers:
        - name: teable
          image: registry.cn-shenzhen.aliyuncs.com/teable/teable:latest
          args: ["skip-migrate"]
          ports:
            - containerPort: 3000
          # 【新增】跳过自签名证书的验证
          env:
            - name: NODE_TLS_REJECT_UNAUTHORIZED
              value: "0"
          envFrom:
            - configMapRef:
                name: teable-config
            - secretRef:
                name: teable-secrets
          resources:
            requests:
              cpu: 200m
              memory: 400Mi
            limits:
              cpu: 1000m
              memory: 1536Mi 
---
apiVersion: v1
kind: Service
metadata:
  name: teable
  namespace: teable
spec:
  type: NodePort 
  selector:
    app: teable
  ports:
    - port: 3000
      targetPort: 3000
      nodePort: 30000
```

```sh
# 1. 部署你上面发给我的这份完美的 YAML（假设文件名叫 teable.yaml）
kubectl create namespace teable
kubectl apply -f teable.yaml

# 2. 等待大概 1-2 分钟，让系统把硬盘建好，并自动初始化一下。
kubectl get pods -n teable
# （看到 postgres-0, minio-0, teable 等都变成 Running 后进行下一步）

# 3. 停掉水电！（把组件副本数缩减为 0，相当于关机，防止它们继续往盘里写数据）
kubectl scale statefulset postgres minio redis -n teable --replicas=0
kubectl scale deployment teable -n teable --replicas=0

# 4. 确认全部关机了（应该只剩下一个叫 minio-setup 的已完成的 Job）
kubectl get pods -n teable

# 5. 查看teable分配的pvc硬盘情况
kubectl get pvc -n teable
```

##### 因为你用的是 `StatefulSet`，K8s 给硬盘起的代号是固定的：

- ##### Postgres 的硬盘叫：`pg-data-postgres-0`

- ##### MinIO 的硬盘叫：`minio-data-minio-0`

##### 我们建一个临时容器，把这两块盘插进去。 创建一个叫 `helper.yaml` 的文件，复制以下内容并执行 `kubectl apply -f helper.yaml`：

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: helper-pod
  namespace: teable
spec:
  containers:
  - name: helper
    image: ubuntu:latest
    command: ["sleep", "infinity"]
    volumeMounts:
    # 名字普普通通，直接挂载为 /data/postgres 和 /data/minio
    - name: pg-vol
      mountPath: /data/postgres
    - name: minio-vol
      mountPath: /data/minio
  volumes:
  - name: pg-vol
    persistentVolumeClaim:
      claimName: pg-data-postgres-0   # K8s 自动生成的 Postgres 硬盘
  - name: minio-vol
    persistentVolumeClaim:
      claimName: minio-data-minio-0   # K8s 自动生成的 MinIO 硬盘
```

```sh
# 执行启动并等待它运行
kubectl apply -f helper.yaml
# 确认搬运工启动成功
kubectl get pod helper-pod -n teable
```

#### 3、文件夹直传（核心操作）

##### **不用进容器内部！** 我们直接在 K8s Master 宿主机上，用 4 条命令搞定所有操作。

##### 假设你在宿主机上的旧数据目录是 `/opt/data/postgres` 和 `/opt/data/minio`，请直接在 Master 节点终端执行：

```sh
# 1. 把 K8s 自动生成的空文件打扫干净
kubectl exec -it helper-pod -n teable -- sh -c "rm -rf /data/postgres/* /data/minio/*"

# 2. 为 Postgres 创建专门的子目录 
# ⚠️ 必须做这步！因为你的 YAML 里写了 PGDATA: /var/lib/postgresql/data/pgdata
kubectl exec -it helper-pod -n teable -- mkdir -p /data/postgres/pgdata

# 3. 直接将宿主机的文件夹内容，拷贝到容器的 Longhorn 硬盘里！
# ⚠️ 注意源路径后面的 "/." 不能漏掉！它代表把里面所有的文件拷过去，而不是把外层文件夹套个娃。
kubectl cp /opt/teable-data/postgres/_data/. teable/helper-pod:/data/postgres/pgdata/
kubectl cp /opt/teable-data/minio/_data/. teable/helper-pod:/data/minio/

# 4. 修复数据库权限（Postgres 认死理，必须是 UID 999 才能读写）
kubectl exec -it helper-pod -n teable -- chown -R 999:999 /data/postgres
```

##### *(注：`kubectl cp` 传输大量碎文件时可能不会显示进度条，如果终端卡住不要慌，是在传输中，耐心等待执行完毕回到命令行即可。)*

#### 4、清理搬运工，重新通电

##### 数据已经全部完美平移到 Longhorn 硬盘里了！

```sh
# 1. 删掉搬运工
kubectl delete pod helper-pod -n teable

# 2. 依次唤醒数据库和存储（恢复为 1 个副本）
kubectl scale statefulset postgres minio redis -n teable --replicas=1

# 3. 唤醒 Teable 主程序！
kubectl scale deployment teable -n teable --replicas=1
```


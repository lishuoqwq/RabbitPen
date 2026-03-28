---
title: K8s高可用环境搭建和迁移
published: 2026-03-26
pinned: true
description: K8s高可用环境搭建和迁移
tags: [k8s,环境迁移]
category: k8s
author: Bunny
image: https://picture.whgd.eu.org/file/1774490256149.png
---

## 企业级别高可用Teable迁移方案

### 📝 环境与角色划分总览

- **K8s Master**: `10.135.40.150` (不参与有状态服务部署)
- **Node 1 (`.151`)**: PG 主库 | Redis队列(主) | Redis性能(从) | MinIO 节点 1
- **Node 2 (`.152`)**: PG 从库 | Redis队列(从) | Redis性能(主) | MinIO 节点 2
- **Node 3 (`.153`)**: (不跑PG) | Redis队列(从) | Redis性能(从) | MinIO 节点 3

### 🐘 第一步：搭建 PostgreSQL 15 (主从复制)

**1. 在 Node 1 (`.151`) 和 Node 2 (`.152`) 上安装 PG 15：**

```sh
# 在 151 和 152 上都执行
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt-get update
sudo apt-get -y install postgresql-15
```

**2. 在 Node 1 (`.151`) 配置主库：**

```sh
# 切换到 postgres 用户
sudo su - postgres

# 登录数据库创建 Teable 用户和复制用户
psql -c "CREATE USER teable_user WITH PASSWORD 'P@ssw0rd';"
psql -c "CREATE DATABASE teable OWNER teable;"
psql -c "CREATE ROLE replicator WITH REPLICATION PASSWORD 'P@ssw0rd' LOGIN;"
exit

# 修改配置允许远程连接和复制
sudo sed -i "s/#listen_addresses = 'localhost'/listen_addresses = '*'/g" /etc/postgresql/15/main/postgresql.conf
sudo sed -i "s/#wal_level = replica/wal_level = replica/g" /etc/postgresql/15/main/postgresql.conf

# 修改 pg_hba.conf 允许密码登录和从库连接
echo "host    all             all             0.0.0.0/0               md5" | sudo tee -a /etc/postgresql/15/main/pg_hba.conf
echo "host    replication     replicator      10.135.40.152/32        md5" | sudo tee -a /etc/postgresql/15/main/pg_hba.conf

# 重启主库
sudo systemctl restart postgresql
```

**3. 在 Node 2 (`.152`) 配置从库：**

```sh
# 停止当前运行的 PG 服务
sudo systemctl stop postgresql

# 清空默认的数据目录
sudo rm -rf /var/lib/postgresql/15/main/*

# 使用 pg_basebackup 从主库同步数据（执行时输入密码 Replicate@123）
sudo -u postgres pg_basebackup -h 10.135.40.151 -D /var/lib/postgresql/15/main -U replicator -P -v -R -X stream

# 启动从库
sudo systemctl start postgresql
```

*验证：PG 搭建完毕，Teable 后续将直接连接 `10.135.40.151:5432`*

**4.清理之前的旧 PG（仅在 .151 和 .152 执行）**

我们需要把之前手动搭的半吊子主从清空，把数据库的控制权完全交给 Patroni。 在 **Node 1 (.151)** 和 **Node 2 (.152)** 执行：

```sh
sudo systemctl stop postgresql
sudo systemctl disable postgresql
# 清空数据目录，Patroni 会帮我们重新初始化并同步
sudo rm -rf /var/lib/postgresql/15/main/*
```

**5.搭建 etcd 集群（分布式大脑）**

Patroni 需要一个大脑来决定“谁是主库”，防止脑裂。etcd 需要奇数个节点，所以我们部署在 `.151`, `.152`, `.153` 三台机器上。

```sh
# Patroni 需要一个大脑来决定“谁是主库”，防止脑裂。etcd 需要奇数个节点，所以我们部署在 .151, .152, .153 三台机器上。
sudo apt-get update
sudo apt-get install -y etcd
```

```sh
# 在 Node 1 (.151) 修改配置：
cat <<EOF | sudo tee /etc/default/etcd
ETCD_NAME="node1"
ETCD_DATA_DIR="/var/lib/etcd/default.etcd"
ETCD_LISTEN_PEER_URLS="http://10.135.40.151:2380"
ETCD_LISTEN_CLIENT_URLS="http://10.135.40.151:2379,http://127.0.0.1:2379"
ETCD_INITIAL_ADVERTISE_PEER_URLS="http://10.135.40.151:2380"
ETCD_INITIAL_CLUSTER="node1=http://10.135.40.151:2380,node2=http://10.135.40.152:2380,node3=http://10.135.40.153:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="teable-etcd-cluster"
ETCD_ADVERTISE_CLIENT_URLS="http://10.135.40.151:2379"
EOF
sudo systemctl restart etcd

# 在 Node 2 (.152) 修改配置：
cat <<EOF | sudo tee /etc/default/etcd
ETCD_NAME="node2"
ETCD_DATA_DIR="/var/lib/etcd/default.etcd"
ETCD_LISTEN_PEER_URLS="http://10.135.40.152:2380"
ETCD_LISTEN_CLIENT_URLS="http://10.135.40.152:2379,http://127.0.0.1:2379"
ETCD_INITIAL_ADVERTISE_PEER_URLS="http://10.135.40.152:2380"
ETCD_INITIAL_CLUSTER="node1=http://10.135.40.151:2380,node2=http://10.135.40.152:2380,node3=http://10.135.40.153:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="teable-etcd-cluster"
ETCD_ADVERTISE_CLIENT_URLS="http://10.135.40.152:2379"
EOF
sudo systemctl restart etcd

# 在 Node 3 (.153) 修改配置：
cat <<EOF | sudo tee /etc/default/etcd
ETCD_NAME="node3"
ETCD_DATA_DIR="/var/lib/etcd/default.etcd"
ETCD_LISTEN_PEER_URLS="http://10.135.40.153:2380"
ETCD_LISTEN_CLIENT_URLS="http://10.135.40.153:2379,http://127.0.0.1:2379"
ETCD_INITIAL_ADVERTISE_PEER_URLS="http://10.135.40.153:2380"
ETCD_INITIAL_CLUSTER="node1=http://10.135.40.151:2380,node2=http://10.135.40.152:2380,node3=http://10.135.40.153:2380"
ETCD_INITIAL_CLUSTER_STATE="new"
ETCD_INITIAL_CLUSTER_TOKEN="teable-etcd-cluster"
ETCD_ADVERTISE_CLIENT_URLS="http://10.135.40.153:2379"
EOF
sudo systemctl restart etcd
```

*(验证：在任意机器执行 `etcdctl cluster-health`，应该显示 cluster is healthy)*

**6.配置 Patroni 自动故障切换**

在 **Node 1 (.151)** 和 **Node 2 (.152)** 机器上安装并配置 Patroni。

```sh
# 在 .151 和 .152 安装 Patroni：
sudo apt-get install -y patroni
# 在 Node 1 (.151) 写入配置：
cat <<EOF | sudo tee /etc/patroni/config.yml
scope: teable-pg-cluster
namespace: /db/
name: pg-node1

restapi:
  listen: 0.0.0.0:8008
  connect_address: 10.135.40.151:8008

etcd:
  hosts: 10.135.40.151:2379,10.135.40.152:2379,10.135.40.153:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
  initdb:
  - auth-host: md5
  - auth-local: trust
  - encoding: UTF8
  - data-checksums
  pg_hba:
  - host replication replicator 10.135.40.0/24 md5
  - host all all 0.0.0.0/0 md5
  users:
    teable:
      password: P@ssw0rd
      options:
        - createdb

postgresql:
  listen: 0.0.0.0:5432
  connect_address: 10.135.40.151:5432
  data_dir: /var/lib/postgresql/15/main
  bin_dir: /usr/lib/postgresql/15/bin
  pgpass: /tmp/pgpass
  authentication:
    replication:
      username: replicator
      password: P@ssw0rd
    superuser:
      username: postgres
      password: P@ssw0rd
EOF
sudo systemctl restart patroni

# 在 Node 2 (.152) 写入配置：
# 配置几乎一样，只需改 name 和 IP
cat <<EOF | sudo tee /etc/patroni/config.yml
scope: teable-pg-cluster
namespace: /db/
name: pg-node2

restapi:
  listen: 0.0.0.0:8008
  connect_address: 10.135.40.152:8008

etcd:
  hosts: 10.135.40.151:2379,10.135.40.152:2379,10.135.40.153:2379

bootstrap:
  dcs:
    ttl: 30
    loop_wait: 10
    retry_timeout: 10
    maximum_lag_on_failover: 1048576
    postgresql:
      use_pg_rewind: true
  initdb:
  - auth-host: md5
  - auth-local: trust
  - encoding: UTF8
  - data-checksums
  pg_hba:
  - host replication replicator 10.135.40.0/24 md5
  - host all all 0.0.0.0/0 md5
  users:
    teable:
      password: P@ssw0rd
      options:
        - createdb

postgresql:
  listen: 0.0.0.0:5432
  connect_address: 10.135.40.152:5432
  data_dir: /var/lib/postgresql/15/main
  bin_dir: /usr/lib/postgresql/15/bin
  pgpass: /tmp/pgpass
  authentication:
    replication:
      username: replicator
      password: P@ssw0rd
    superuser:
      username: postgres
      password: P@ssw0rd
EOF
sudo systemctl restart patroni
```

为了确保 100% 成功，我们**先只启动 Node 1，等它成为 Leader 后，再启动 Node 2。**

```sh
# 成功标志，像这样：
+----------+---------------+--------+---------+----+-----------+
| Member   | Host          | Role   | State   | TL | Lag in MB |
+----------+---------------+--------+---------+----+-----------+
| pg-node1 | 10.135.40.151 | Leader | running |  1 |           |
+----------+---------------+--------+---------+----+-----------+
```

*(验证：执行 `patronictl -c /etc/patroni/config.yml list`，你会看到 pg-node1 是 Leader，pg-node2 是 Replica，状态都是 running)*

```sh
# 初始化 Teable 数据库（仅在 Leader 节点 .151 执行一次）
sudo -u postgres psql -c "CREATE DATABASE teable OWNER teable;"
```

**7.配置 HAProxy（智能路由）**

应用不用管谁是主库，直接连 HAProxy，HAProxy 会自动把流量转发给当前的 Leader。

在 **Node 1 (.151)** 和 **Node 2 (.152)** 上执行：

```sh
sudo apt-get install -y haproxy

cat <<EOF | sudo tee /etc/haproxy/haproxy.cfg
global
    maxconn 1000
    daemon

defaults
    log global
    mode tcp
    retries 2
    timeout client 30m
    timeout connect 4s
    timeout server 30m
    timeout check 5s

listen postgres
    bind *:5000
    option httpchk GET /master
    http-check expect status 200
    default-server inter 3s fall 3 rise 2 on-marked-down shutdown-sessions
    server pg1 10.135.40.151:5432 maxconn 500 check port 8008
    server pg2 10.135.40.152:5432 maxconn 500 check port 8008
EOF

sudo systemctl restart haproxy
```

*(现在，访问 `151:5000` 或 `152:5000` 都能直接连到主库了！)*

**8.配置 Keepalived（虚拟 IP）**

最后一步，弄一个永远不宕机的 IP (`10.135.40.160`)。

```sh
# 在 **Node 1 (.151)** 和 **Node 2 (.152)** 上安装：
sudo apt-get install -y keepalived

# 在 Node 1 (.151) 配置为 MASTER：
cat <<EOF | sudo tee /etc/keepalived/keepalived.conf
vrrp_script chk_haproxy {
    script "killall -0 haproxy" # 检查 HAProxy 是否活着
    interval 2
    weight 2
}

vrrp_instance VI_1 {
    interface ens16 # 请用 'ip a' 命令确认你的网卡名，有可能是 ens33 或 eth16，必须填对！
    state MASTER
    virtual_router_id 51
    priority 101 # 优先级高
    virtual_ipaddress {
        10.135.40.160 # 你的虚拟 IP
    }
    track_script {
        chk_haproxy
    }
}
EOF
sudo systemctl restart keepalived

# 在 Node 2 (.152) 配置为 BACKUP：
cat <<EOF | sudo tee /etc/keepalived/keepalived.conf
vrrp_script chk_haproxy {
    script "killall -0 haproxy"
    interval 2
    weight 2
}

vrrp_instance VI_1 {
    interface eth16 # 同样，确保网卡名是对的
    state BACKUP
    virtual_router_id 51
    priority 100 # 优先级略低
    virtual_ipaddress {
        10.135.40.160 # 同一个虚拟 IP
    }
    track_script {
        chk_haproxy
    }
}
EOF
sudo systemctl restart keepalived
```

*(验证：在 `.151` 执行 `ip a`，你应该能看到 `10.135.40.160` 这个 IP 挂在你的网卡上。如果 `.151` 关机，它会瞬间跑去 `.152`)*



### 🔴 第二步：搭建两套 Redis 实例

*目标：在 3 台机器上运行两个 Redis 进程 (6379 和 6380)。按照你的要求进行主从交叉配置。*

**1. 在所有三台机器 (`.151`, `.152`, `.153`) 上安装 Redis：**

```sh
sudo apt-get update
sudo apt-get install -y redis-server
# 停止默认服务，我们自己配置
sudo systemctl stop redis-server
sudo systemctl disable redis-server
```

**2. 在所有三台机器上创建两套目录和基础配置文件：**

```sh
sudo mkdir -p /etc/redis /var/lib/redis/queue /var/lib/redis/perf
sudo chown -R redis:redis /var/lib/redis

# 创建队列缓存配置 (6379)
cat <<EOF | sudo tee /etc/redis/redis-queue.conf
port 6379
dir /var/lib/redis/queue
bind 0.0.0.0
protected-mode no
requirepass P@ssw0rd
masterauth P@ssw0rd
daemonize yes
pidfile /var/run/redis/redis-queue.pid
logfile /var/log/redis/redis-queue.log
EOF

# 创建性能缓存配置 (6380)
cat <<EOF | sudo tee /etc/redis/redis-perf.conf
port 6380
dir /var/lib/redis/perf
bind 0.0.0.0
protected-mode no
requirepass P@ssw0rd
masterauth P@ssw0rd
daemonize yes
pidfile /var/run/redis/redis-perf.pid
logfile /var/log/redis/redis-perf.log
EOF
```

**3. 配置主从关系 (最关键的一步)：**

**在 Node 2 (`.152`) 和 Node 3 (`.153`) 上**，配置队列(6379)从属于 Node 1：

```sh
echo "replicaof 10.135.40.151 6379" | sudo tee -a /etc/redis/redis-queue.conf
```

**在 Node 1 (`.151`) 和 Node 3 (`.153`) 上**，配置性能(6380)从属于 Node 2：

```sh
echo "replicaof 10.135.40.152 6380" | sudo tee -a /etc/redis/redis-perf.conf
```

**4. 在三台机器上启动这两套 Redis：**

```sh
sudo -u redis redis-server /etc/redis/redis-queue.conf
sudo -u redis redis-server /etc/redis/redis-perf.conf
```

*验证：6379 主节点在 `.151`，6380 主节点在 `.152`。Teable 将连接这两个主节点写入数据。*

**5. 验证主从角色（最重要）**

```sh
# 在 Node 1 (.151) 上验证 6379 是主节点：
redis-cli -p 6379 -a P@ssw0rd INFO replication
# 在 Node 2 (.152) 上验证 6379 是从节点：
redis-cli -p 6379 -a P@ssw0rd INFO replication

# 在 Node 2 (.152) 上验证 6380 是主节点：
redis-cli -p 6380 -a P@ssw0rd INFO replication
# 在 Node 3 (.153) 上验证 6380 是从节点：
redis-cli -p 6380 -a P@ssw0rd INFO replication
```

**6.测试数据同步**

```sh
测试队列缓存（6379）：
# 在 Node 1 (.151) 主节点写入
redis-cli -p 6379 -a P@ssw0rd SET test_queue "hello"
# 在 Node 2 (.152) 从节点读取
redis-cli -p 6379 -a P@ssw0rd GET test_queue
# 应该返回 "hello"

测试性能缓存（6380）
# 在 Node 2 (.152) 主节点写入
redis-cli -p 6380 -a P@ssw0rd SET test_perf "world"
# 在 Node 1 (.151) 从节点读取
redis-cli -p 6380 -a P@ssw0rd GET test_perf
# 应该返回 "world"
```

### 📦 第三步：搭建 MinIO 3节点集群

*目标：在三台机器上搭建分布式 MinIO。由于 MinIO 分布式要求至少 4 个驱动器(盘)，我们可以在每台机器上创建 2 个目录，3台机器共计 6 个“盘”来完美满足集群要求。*

**1. 在三台机器 (`.151`, `.152`, `.153`) 上执行相同操作：**

```sh
# 下载 MinIO 二进制文件
wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
sudo mv minio /usr/local/bin/

# 创建两个数据目录以满足分布式盘数要求
sudo mkdir -p /data/minio/disk1 /data/minio/disk2
sudo chown -R $USER:$USER /data/minio
```

**2. 在三台机器上创建启动脚本 (环境变量保持一致)：**

```sh
cat <<EOF | sudo tee /etc/systemd/system/minio.service
[Unit]
Description=MinIO
Wants=network-online.target
After=network-online.target

[Service]
User=root
Environment="MINIO_ROOT_USER=admin"
Environment="MINIO_ROOT_PASSWORD=P@ssw0rd"
Environment="MINIO_CI_CD=1" # 强制使用根分区目录（仅测试环境）
ExecStart=/usr/local/bin/minio server http://10.135.40.15{1...3}:9000/data/minio/disk{1...2} --console-address ":9001"
Restart=always
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
```

**3. 在三台机器上启动 MinIO 集群：**

```sh
sudo systemctl daemon-reload
sudo systemctl enable minio
sudo systemctl start minio
```

*验证：浏览器访问 `http://10.135.40.151:9001`，账号 `teable_admin`，密码 `TeableMinio@123`。登录后手动创建 `teable-public` 和 `teable-private` 两个 Bucket。*

### 🚀 第四步：Minio数据迁移

**1. 先安装 MinIO Client (mc)：**

```sh
wget https://dl.min.io/client/mc/release/linux-amd64/mc
chmod +x mc
sudo mv mc /usr/local/bin/
```

**2. 配置 mc 连接到你的 MinIO 集群：**

```sh
# 使用你的实际域名或 IP
mc alias set teable-minio http://10.135.40.151:9000 admin P@ssw0rd

# 测试连接
mc admin info teable-minio
```

**3. 创建存储桶并设置权限：**

```sh
# 创建公共桶
mc mb --ignore-existing teable-minio/teable-pub

# 设置公共读取权限
mc anonymous set download teable-minio/teable-pub

# 创建私有桶
mc mb --ignore-existing teable-minio/teable-pvt

# 验证
mc ls teable-minio

# 查看 teable-pub 的权限
mc anonymous get teable-minio/teable-pub

# 查看 teable-pvt 的权限（应该是 private）
mc anonymous get teable-minio/teable-pvt
```

**4.配置新老 MinIO 的连接别名**

```sh
# 使用以下命令查看 MinIO 客户端当前配置的所有别名：
mc alias list

teable-minio
  URL       : http://10.135.40.151:9000
  AccessKey : admin
  SecretKey : P@ssw0rd
  API       : s3v4
  Path      : auto
  Src       : /root/.mc/config.json

# 连接旧的 K8s MinIO
mc alias set teable-minio http://10.135.40.150:32000 root 'P@ssw0rd'
# 设置成功后，你就可以像之前一样查看文件了：
mc ls teable-minio

# 连接新的物理机 MinIO 集群
mc alias set teable-minio http://10.135.40.151:9000 admin 'P@ssw0rd'

# 详细查看存储桶使用量
mc du teable-minio/teable-pvt
1.3GiB  965 objects     teable-pvt

mc du teable-minio/teable-pub
87KiB   62 objects      teable-pub

# 执行复制（镜像）操作
mc mirror --preserve source-minio/teable-pub teable-minio/teable-pub
mc mirror --preserve source-minio/teable-pvt teable-minio/teable-pvt
```

### 🚀 第五步：PostgreSQL 数据迁移

**1. 从旧的 Pod 中导出数据** *(注：使用 `-O -x` 参数是为了忽略旧的权限和所有者，这样导入新库时不会因为用户名不一致报错)*

```sh
kubectl exec -it postgres-0 -n teable -- pg_dump -U teable -d teable -O -x -f /tmp/teable_dump.sql
```

**2. 把数据文件拷贝到 K8s Master 本地**

```sh
kubectl cp teable/postgres-0:/tmp/teable_dump.sql ./teable_dump.sql
```

**3. 在 Master 节点安装 PostgreSQL 客户端**

```sh
psql -h 10.135.40.160 -p 5000 -U teable -d teable -f ./teable_dump.sql
```

*如果屏幕上刷刷刷地输出 `INSERT 0 1`, `CREATE TABLE` 等字样，说明数据库迁移成功！*

```sh
**最后报错的仅仅是两个高级附加功能**

1. **`WARNING: wal_level is insufficient`**：Teable 的实时协作功能（多人在同一个表格打字实时同步）依赖 PostgreSQL 的**逻辑复制 (Logical Replication)** 功能，这要求数据库的 `wal_level` 必须设置为 `logical`，而你目前的 Patroni 默认是 `replica`。
2. **`ERROR: permission denied to create event trigger`**：Teable 需要在数据库里创建一个“事件触发器”来监听表结构的变化，这在 PostgreSQL 中强制要求执行者必须拥有 **超级用户 (SUPERUSER)** 权限，而你的 `teable` 只是普通用户。

这两个问题非常容易解决，我们需要在物理机上修改一下配置，然后把最后缺失的触发器补上即可。

# 提升 teable 为超级用户，在你的 物理机 Node 1 (.151) 上执行以下命令，给业务账号赋权：
sudo -u postgres psql -c "ALTER USER teable WITH SUPERUSER;"

# 修改 Patroni 配置开启逻辑复制
#在 物理机 Node 1 (.151) 上，我们需要修改 Patroni 的配置。输入以下命令进入配置编辑模式：
sudo patronictl -c /etc/patroni/config.yml edit-config
# 找到 postgresql -> parameters 这一层级，在下面添加一行 wal_level: logical。修改后看起来应该是这样的：
postgresql:
  parameters:
    wal_level: logical    # <--- 加上这一行
    max_connections: 500  # (原有的其他配置保持不变...)
    
# 重启数据库集群使配置生效
# 在 Node 2 (.152) 执行：
sudo systemctl restart patroni
# 等 10 秒后，在 Node 1 (.151) 执行：
sudo systemctl restart patroni

# 回到你的 K8s Master 节点，补齐最后缺失的触发器
psql -h 10.135.40.154 -p 5000 -U teable -d teable -f /opt/teable_dump.sql
```

```sh
# 报错新数据库里根本没有这个“角色 (Role)，base_schema_table_read_only_role

psql -h 10.135.40.154 -p 5000 -U teable -d teable -c "
DROP ROLE IF EXISTS base_schema_table_read_only_role;
CREATE ROLE base_schema_table_read_only_role WITH LOGIN PASSWORD 'P@ssw0rd';
GRANT pg_read_all_data TO base_schema_table_read_only_role;"
# (执行时输入密码 P@ssw0rd，看到输出 GRANT 即为成功)
```

### 🎉 第六步：在 K8s 中部署 Teable 无状态层

有状态服务在宿主机跑起来后，现在我们回到 **K8s Master 节点 (`10.135.40.150`)**，把 Teable 部署到 K8s 里，并将连接指向宿主机。

**1. 创建 `teable-config.yaml`：** 注意看这里的 IP 地址，都是直接指向你刚才配置的宿主机物理 IP。

```sh
---
# ==========================================
# 1. 基础配置层 (ConfigMap)
# ==========================================
apiVersion: v1
kind: ConfigMap
metadata:
  name: teable-config
  namespace: teable
data:
  # 应用对外访问入口
  PUBLIC_ORIGIN: "http://10.135.40.150:30000"

  PUBLIC_DATABASE_PROXY: "10.135.40.160:5000"
  
  # MinIO 存储配置 (全部指向物理机 10.135.40.151)
  BACKEND_STORAGE_PROVIDER: "minio"
  BACKEND_STORAGE_PUBLIC_BUCKET: "teable-pub"
  BACKEND_STORAGE_PRIVATE_BUCKET: "teable-pvt"
  
  # 外网端点 (由于是内网环境，内外网端点一致)
  BACKEND_STORAGE_MINIO_ENDPOINT: "10.135.40.151"
  BACKEND_STORAGE_MINIO_PORT: "9000"
  STORAGE_PREFIX: "http://10.135.40.151:9000"
  
  # 内网端点 (不再使用 svc.cluster.local，直接写物理机 IP)
  BACKEND_STORAGE_MINIO_INTERNAL_ENDPOINT: "10.135.40.151"
  BACKEND_STORAGE_MINIO_INTERNAL_PORT: "9000"
  BACKEND_STORAGE_MINIO_USE_SSL: "false"
  
  # 缓存配置
  BACKEND_CACHE_PROVIDER: "redis"
  
  # 系统常量
  NEXT_ENV_IMAGES_ALL_REMOTE: "true"
  PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING: "1"
  NODE_TLS_REJECT_UNAUTHORIZED: "0"

---
# ==========================================
# 2. 机密信息层 (Secret)
# ==========================================
apiVersion: v1
kind: Secret
metadata:
  name: teable-secrets
  namespace: teable
type: Opaque
stringData:
  # 高可用 PostgreSQL (HAProxy VIP: 10.135.40.154:5000)
  # 注意：密码 P@ssw0rd 必须转码为 P%40ssw0rd
  PRISMA_DATABASE_URL: "postgresql://teable:P%40ssw0rd@10.135.40.154:5000/teable?schema=public"
  
  # 独立 Redis 集群
  # 密码 Redis@123 转码为 Redis%40123
  BACKEND_CACHE_REDIS_URI: "redis://:P%40ssw0rd@10.135.40.151:6379/0"
  BACKEND_PERFORMANCE_CACHE: "redis://:P%40ssw0rd@10.135.40.152:6380/1"
  
  # 系统密钥
  BACKEND_JWT_SECRET: "teable-prod-jwt-secret-secure-key"
  BACKEND_SESSION_SECRET: "teable-prod-session-secret-secure-key"
  
  # MinIO 凭证
  BACKEND_STORAGE_MINIO_ACCESS_KEY: "admin"
  BACKEND_STORAGE_MINIO_SECRET_KEY: "P@ssw0rd"

---
# ==========================================
# 3. 业务应用层 (Deployment)
# ==========================================
apiVersion: apps/v1
kind: Deployment
metadata:
  name: teable
  namespace: teable
spec:
  replicas: 3 # 生产环境推荐 3 副本抗并发
  selector:
    matchLabels:
      app: teable
  template:
    metadata:
      labels:
        app: teable
    spec:
      # 软反亲和性：尽量将 3 个 Pod 调度到不同的 K8s Node 上，防止单台宿主机宕机导致服务全挂
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - teable
              topologyKey: "kubernetes.io/hostname"
              
      # 初始化容器：执行数据库表结构合并与升级
      initContainers:
        - name: db-migrate
          image: registry.cn-shenzhen.aliyuncs.com/teable/teable:latest
          args:
            - migrate-only
          envFrom:
            - configMapRef:
                name: teable-config
            - secretRef:
                name: teable-secrets
          resources:
            requests:
              cpu: 100m
              memory: 102Mi
            limits:
              cpu: 1000m
              memory: 1024Mi
              
      # 主业务容器
      containers:
        - name: teable
          image: registry.cn-shenzhen.aliyuncs.com/teable/teable:latest
          args:
            - skip-migrate
          ports:
            - containerPort: 3000
          envFrom:
            - configMapRef:
                name: teable-config
            - secretRef:
                name: teable-secrets
          # 资源配额：针对 50+ 用户的生产标准
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: 2000m
              memory: 4096Mi
              
          # 官方推荐的健康检查探针组合
          startupProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 30 # 给予最多 300 秒的启动时间
            successThreshold: 1
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
            successThreshold: 1
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3
            successThreshold: 1

---
# ==========================================
# 4. 服务暴露层 (Service)
# ==========================================
apiVersion: v1
kind: Service
metadata:
  name: teable
  namespace: teable
spec:
  type: NodePort
  ports:
    - port: 3000
      targetPort: 3000
      nodePort: 30000 # 固定外网访问端口，对应 PUBLIC_ORIGIN
  selector:
    app: teable
```

**2.高可用HPA负载均衡搭建**

```sh
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: teable-hpa
  namespace: teable
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: teable    # 关联你 YAML 里的 teable Deployment
  minReplicas: 1    # 闲时：最小保留 1 个 Pod（省资源）
  maxReplicas: 3   # 忙时：最多扩容到 3 个 Pod
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 60  # 当 CPU 使用率达到 requests(200m) 的 60% 时，触发扩容
```

**3. 在 K8s Master 上应用配置：**

```sh
# 应用（创建或更新）配置文件
kubectl apply -f teable-config.yaml

# 实时监控 Pod 的运行状态
kubectl get pods -n teable -w

# 通过标签（Label）批量删除并强制重建 Pod
kubectl delete pods -l app=teable -n teable

# 查看特定 Pod 的详细信息和诊断日志（排错必备）
kubectl describe pod teable-<最新Pod> -n teable

# 平滑（滚动）重启 Deployment
kubectl rollout restart deployment teable -n teable
```

**3. 最终验证：**

- 等待 Pod 启动完毕：`kubectl get pods`

- 打开你的浏览器，访问 `http://10.135.40.151:30000` 或 `152`、`153` 的 30000 端口。

- 你现在应该能看到 Teable 的界面了！

    


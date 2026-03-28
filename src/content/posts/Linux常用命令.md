---
title: Linux常用命令
published: 2025-02-17
pinned: true
description: Linux系统中一些常用命令整理
tags: [Linux]
slug: Linux
author: Bunny
draft: false
date: 2025-01-20
image: https://picture.whgd.eu.org/file/1737613131026_【哲风壁纸】笑嘻嘻-美女.png
pubDate: 2025-01-20
---

## Ubuntu Server如何设置静态IP

```shell
#进入netplan目录
cd /etc/netplan

#修改yaml文件为
# This is the network config written by 'subiquity'
network:
  version: 2
  renderer: networkd
  ethernets:
    ens33:
      dhcp4: no
      addresses: [10.135.30.59/24]
      gateway4: 10.135.30.254
      routes:  
        - to: default  
          via: 10.135.30.254
      nameservers:  
        addresses: [8.8.8.8, 114.114.114.144]

#刷新一下netplan，检测IP是否变化
netplan apply
hostname -I 
```

## ubuntu开启SSH

```shell
# 安装openssh-server
apt update
apt install openssh-server

# 安装完成后,查看ssh是否开启，如果没启动就手动
systemctl status ssh
/etc/init.d/ssh start

# 配置SSH
vim /etc/ssh/sshd_config
将PermitRootLogin prohibit-password修改为PermitRootLogin yes

#重启ssh并设置开机自启ssh
systemctl restart ssh
systemctl enable ssh

#更改管理员root密码
passwd 123456
```

## Ubuntu 22.04扩容磁盘LVM空间

```sh
# 将新的空间新建一个磁盘分区
fdisk /dev/sda
-----------------------------------------------------------------------------------------
Welcome to fdisk (util-linux 2.37.2).
Changes will remain in memory only, until you decide to write them.
Be careful before using the write command.

GPT PMBR size mismatch (83886079 != 167772159) will be corrected by write.
This disk is currently in use - repartitioning is probably a bad idea.
It's recommended to umount all file systems, and swapoff all swap
partitions on this disk.


Command (m for help): n
Partition number (4-128, default 4):
First sector (83884032-167772126, default 83884032):
Last sector, +/-sectors or +/-size{K,M,G,T,P} (83884032-167772126, default 167772126):

Created a new partition 4 of type 'Linux filesystem' and of size 40 GiB.

Command (m for help): w
The partition table has been altered.
Syncing disks.
-----------------------------------------------------------------------------------------

# 将新建的分区sda4转换为PV并拓展ubuntu-vg这个卷组
pvcreate -ff -y /dev/sda4
Physical volume "/dev/sda4" successfully created.

vgextend ubuntu-vg /dev/sda4
Volume group "ubuntu-vg" successfully extended.

#扩容ubuntu-lv这个逻辑空间，并df -h查看
lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
```



```shell
# 将新的空间新建一个磁盘分区
fdisk /dev/sda
-----------------------------------------------------------------------------------------
Welcome to fdisk (util-linux 2.37.2).
Changes will remain in memory only, until you decide to write them.
Be careful before using the write command.

GPT PMBR size mismatch (83886079 != 167772159) will be corrected by write.
This disk is currently in use - repartitioning is probably a bad idea.
It's recommended to umount all file systems, and swapoff all swap
partitions on this disk.


Command (m for help): n
Partition number (4-128, default 4):
First sector (83884032-167772126, default 83884032):
Last sector, +/-sectors or +/-size{K,M,G,T,P} (83884032-167772126, default 167772126):

Created a new partition 4 of type 'Linux filesystem' and of size 40 GiB.

Command (m for help): w
The partition table has been altered.
Syncing disks.
-----------------------------------------------------------------------------------------

# 将新建的分区sda4转换为PV并拓展ubuntu-vg这个卷组
pvcreate -ff -y /dev/sda4
Physical volume "/dev/sda4" successfully created.

vgextend ubuntu-vg /dev/sda4
Volume group "ubuntu-vg" successfully extended.

#扩容ubuntu-lv这个逻辑空间，并df -h查看
lvextend -l +100%FREE /dev/ubuntu-vg/ubuntu-lv
```

## Docker 翻墙VPN配置指令和镜像仓库配置

```shell
# 代理Windows的翻墙软件实现下载
export http_proxy="http://10.135.20.153:7890"
export https_proxy="https://10.135.20.153:7890"

#代理Docker实现翻墙下载Dockerhub仓库拉取
vim /etc/docker/daemon.json

#配置翻墙VPN
{
  "proxies": {
        "http-proxy": "http://10.135.30.71:7890",
        "https-proxy": "http://10.135.30.71:7890"
    }
}

#配置镜像仓库
{
	"registry-mirrors": ["https://docker.rainbond.cc/"]
}

# 加载systemd配置并重启docker
systemctl daemon-reload
systemctl restart docker
```

## Docker使用本地仓库进行推拉送服务

```shell
# 使用insecure-registries参数添加http支持
vim /etc/docker/daemon.json

#添加如下内容
{
  "insecure-registries":["10.135.40.180"]
}

# 重启systemctl服务
systemctl daemon-reload
systemctl restart docker

# 检查是否连接docker harbor仓库
docker login 10.135.40.180
username：admin
password：P@ssw0rd
--------------- 出现如下显示，则表示登陆成功 --------------
Authenticating with existing credentials...
Login Succeeded...

------对本地Docker容器进行打标签------
# 查看本地Docker容器标签名
docker images 
docker tag SOURCE_IMAGE[:TAG] 10.135.40.180/repository/REPOSITORY[:TAG]
# 例如参考如下命令
docker tag tomcat:latest(已经存在的容器名+标签名) 10.135.40.180/repository/tomcat:v1(所需打标签的容器名+标签名)
# 再执行以下docker images 则可以看到容器内新打上的容器+标签名

------使用Docker命令进行push推送至Harbor服务器内------
# 推送镜像到当前项目
docker push 10.135.40.180/repository/REPOSITORY[:TAG]
# 例如参考如下命令
docker push 10.135.40.180/repository/tomcat:v1(已经打好标签的容器名+标签名)

------使用Docker命令进行pull推送至本地服务器内------
# 拉取Docker镜像至本地服务器
docker pull 10.135.40.180/repository/REPOSITORY[:TAG]
# 例如参考如下命令
docker pull 10.135.40.180/repository/tomcat:v1(已经打好标签的容器名+标签名)
```

## 局域网搭建浏览器可信任的SSL证书

```shell
# 创建CA机构证书
openssl genrsa -out myCA.key 2048
openssl req -new -x509 -key myCA.key -out myCA.cer -days 36500

#创建服务器证书
openssl genrsa -out server.key 2048

#创建一个签名请求
vim openssl.cnf
-----------------------------------------------------------------------------------------
[ req ]
distinguished_name = req_distinguished_name
req_extensions = v3_req
[ req_distinguished_name ]
countryName                     = Country Name (2 letter code)
countryName_default             = XX
countryName_min                 = 2
countryName_max                 = 2
stateOrProvinceName             = State or Province Name (full name)
#stateOrProvinceName_default    = Default Province
localityName                    = Locality Name (eg, city)
localityName_default            = Default City
0.organizationName              = Organization Name (eg, company)
0.organizationName_default      = Default Company Ltd
# we can do this but it is not needed normally :-)
#1.organizationName             = Second Organization Name (eg, company)
#1.organizationName_default     = World Wide Web Pty Ltd
organizationalUnitName          = Organizational Unit Name (eg, section)
#organizationalUnitName_default =
commonName                      = Common Name (eg, your name or your server\'s hostname)
commonName_max                  = 64
emailAddress                    = Email Address
emailAddress_max                = 64
# SET-ex3                       = SET extension number 3
[ v3_req ]
subjectAltName = @alt_names

[ alt_names ]
DNS.1 = 8.8.8.8
IP.1 = 192.168.1.2
-----------------------------------------------------------------------------------------

#生成的服务器证书文件
openssl req -config openssl.cnf -new -out server.req -key server.key

#通过CA机构证书对服务器证书进行签名认证
openssl x509 -req  -extfile openssl.cnf -extensions v3_req -in server.req -out server.cer -CAkey myCA.key -CA myCA.cer -days 36500 -CAcreateserial -CAserial serial
```

## Ubuntu挂载磁盘

```shell
# 使用fdisk命令
fdisk -l

# 磁盘创建一个 ext4 文件系统
mkfs.ext4 /dev/vdb

# 创建挂载点
mkdir /data

# 挂载硬盘
mount /dev/vdb /data

# 设置开机自动挂载
blkid /dev/vdb

记住其中的 UUID="xxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

重启系统或使用 df -h 命令来验证 /dev/vdb 是否已成功挂载到 /data 目录
```


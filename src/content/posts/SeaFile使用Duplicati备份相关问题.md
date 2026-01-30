---
title: SeaFile使用Duplicati备份
published: 2025-05-30
pinned: true
description: 记录一次解决SeaFile使用Duplicati备份的过程
tags: [Linux,Seafile,备份]
category: backup
author: Bunny
draft: false
date: 2025-05-30
image: https://picture.whgd.eu.org/file/1737529915890_【哲风壁纸】2025-可爱.png
pubDate: 2025-05-30
---

## Duplicati备份相关

##### 由于没有GUI界面的Linux的发行版本的包管理删去了其中比较重要的三个包管理组件,如下所示报错信息

```sh
dpkg:dependency problems prevent configuration of duplicati:
duplicati depends on libappindicator0.1-cil I libappindicator3-0.1-cil I lib
yatana-appindicator1;however:

Package libappindicator0.1-cil is not installed.
Packagelibappindicator3-0.1-cil is not installed.
Packagelibayatana-appindicator1 is not installed.

duplicati depends on gtk-sharp2;however:
Package gtk-sharp2 is not installed.
dpkg: error processing package duplicati (--install):
dependency problems - leaving unconfigured

Processing triggers for mailcap (3.70+nmu1ubuntu1)
Errors were encounteredwhile processing
```

##### 目前解决方法就是使用Docker的方式启动Duplicati进行备份和恢复



#### 一、配置本地镜像仓库地址或者代理Dockerhub的镜像仓库地址

##### 1.配置代理仓库地址

```sh
vim /etc/docker/daemon.json

#配置文件内容如下：

{
    "registry-mirrors": ["https://docker.rainbond.cc/"],
    "insecure-registries":["10.135.40.180"]
}

# 加载systemd配置并重启docker
systemctl daemon-reload
systemctl restart docker
```

##### 2.使用代理下载所需的duplicati容器镜像

```sh
1.直接拉取镜像仓库image容器（速度慢）
docker pull lscr.io/linuxserver/duplicati：latest

2.使用本地镜像仓库拉取image容器（速度快）
docker login 10.135.40.180
username：admin
password：P@ssw0rd
--------------- 出现如下显示，则表示登陆成功 --------------
Authenticating with existing credentials...
Login Succeeded...

3.拉取docker镜像
docker pull 10.135.40.180/repository/linuxserver/duplicati:latest
```



#### 二、启动docker或创建docker-compose配置文件

##### 1.启动dokcer容器

```sh
docker run -d \
  --name=duplicati \
  -e PUID=1000 \
  -e PGID=1000 \
  -e TZ=Etc/UTC \
  -p 8200:8200 \
  -v /data/appdata/config:/config \
  -v /data/backups:/backups \
  -v /:/source \
  --restart unless-stopped \
  lscr.io/linuxserver/duplicati:latest
```



##### 2.创建docker-compose配置文件如下所示

```yaml
version: "2.1"
services:
  duplicati:
    # 下面俩个image镜像二选一，不需要的注释即可
    image: lscr.io/linuxserver/duplicati:latest #image容器镜像
    image: 10.135.40.180/repository/linuxserver/duplicati:latest #本地image容器镜像
    container_name: duplicati
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
    volumes:
      - /data/duplicati/config:/config
      - /opt:/opt
    ports:
      - 8200:8200
    restart: unless-stopped
```

最后`docker-compose  up -d`启动容器即可



### 三、备份恢复数据后启动seafile服务

![notion image](https://www.notion.so/image/https%3A%2F%2Fprod-files-secure.s3.us-west-2.amazonaws.com%2F8973461d-7d99-4f5e-88bc-227e1346560c%2Fc0fb4567-34f4-4b87-a301-312b7286edd8%2Fe67345c52508553ec46a8c28e5c1aab.png?table=block&id=12896b88-7fff-80e7-aaa5-c56f2ce23c10&t=12896b88-7fff-80e7-aaa5-c56f2ce23c10&width=843.984375&cache=v2)

使用docker-compose up 查看启动报错日志，若出现这种报错，则需要使用这行命令

```bash
chown -R root:root /opt/seafile-data
```

然后重启docker-comopse up -d即可打开

最后再更改一下后台的URL地址即可

![notion image](https://www.notion.so/image/https%3A%2F%2Fprod-files-secure.s3.us-west-2.amazonaws.com%2F8973461d-7d99-4f5e-88bc-227e1346560c%2Fce3268ce-75de-42aa-a855-78ef445bd681%2Fimage.png?table=block&id=12896b88-7fff-80a9-9887-d0af7019502a&t=12896b88-7fff-80a9-9887-d0af7019502a&width=843.984375&cache=v2)
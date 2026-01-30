---
title: 从零开始搭建Bolo个人博客系统
published: 2025-07-13
pinned: true
description: 记录一次从零开始搭建Bolo个人博客系统
tags: [建站,博客]
category: website
author: Bunny
draft: false
date: 2025-01-30
image: https://picture.whgd.eu.org/file/1769775144680_【哲风壁纸】SNAFFUR-动漫少女.png
pubDate: 2025-01-30
---

自己个人博客系统从搭建运行至今，整个搭建过程可以说是踩坑无数。因此将整个搭建过程以及踩过的坑写到此处，希望可以给搭建个人博客系统的朋友提供一些帮助。整个过程教程包括安装 Bolo、Nginx 进行反向代理以及 SSL证书的申请与使用。云服务器的选购、域名的购买与备案、域名服务器解析就不多赘述了，百度可查。

## Bolo的安装

### 一：获取最新的镜像

```sh
docker pull tangcuyu/bolo-solo
```

### 二：安装 MySQL

```sh
# 安装mysql:5.6,直接docker run 他会自动去官方镜想下载
# MYSQL_ROOT_PASSWORD=[的数据库密码，此处写的是123456
docker run --name mysql -p 3306:3306 -e MYSQL_ROOT_PASSWORD=123456 -d mysql:5.7
# docker安装的mysql默认允许远程连接，可以使用Navicat等软件连接数据库
# 进入容器mysql
docker exec -it mysql bash

# 进入数据库 p后面跟你的密码
mysql -uroot -p123456

# 创建数据库(数据库名:solo;字符集utf8mb4;排序规则utf8mb4_general_ci)
create database bolo DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
# 出现Query OK, 1 row affected (0.00 sec)表示成功
#退出数据库
exit
#退出容器
exit
```

### 三：安装Bolo

运行如下命令：

```sh
docker run --detach --name bolo --network=host \
--env RUNTIME_DB="MYSQL" \
--env JDBC_USERNAME="root" \
--env JDBC_PASSWORD="123456" \
--env JDBC_DRIVER="com.mysql.cj.jdbc.Driver" \
--env JDBC_URL="jdbc:mysql://127.0.0.1:3306/solo?useUnicode=yes&characterEncoding=UTF-8&useSSL=false&serverTimezone=UTC" \
tangcuyu/bolo-solo --listen_port=8080 --server_scheme=http --server_host=www.hostname.com(域名/IP地址)
```

- `--detach:` 这个选项告诉 Docker 在启动后将程序与控制台分离，使其进入`后台` 运行。
- `--name bolo:` `bolo` 是容器的名字，也可以改成自己喜欢的名字如 `MyBolo`，这个无所谓
- `RUNTIME_DB="MYSQL":` 指明我们此处使用的数据库为 `MYSQL`
- `JDBC_USERNAME="root"：` 指明 `MYSQL` 数据连接时使用的用户名，默认都是 `root`
- `JDBC_PASSWORD="123456":`指明 `MySQL` 数据库连接时用户密码，使用时注意将 `123456` 替换成自己在上一步所设置的密码
- `env JDBC_DRIVER="com.mysql.cj.jdbc.Driver":`数据库连接驱动包
- `--server_host=www.hostname.com:`个人域名，如果没有可设置为自己的服务器` IP`
- --`env JDBC_URL`=..... ：数据库的`IP`地址。如果是在本地安装的直接写`127.0.0.1`，如果通过`docker`安装将其改成自己的服务器的`IP`地址
- `--listen_port=8080`:指明 solo 监听的端口此处使用的是 `8080`,如果不想配置 `nginx` 此处可以换成 `80`

命令执行完成之后没有报错的话，通过 `docker ps` 查看当前当前容器列表中是否有名字叫 `bolo` 的容器，如果有证明启动成功了，此时可以通过 `个人域名/ip+:8080` 来进行访问，类似 `http://192.168.30.2:8080`,如果不想配置 nginx 可以将 `8080` 换成 `80`，可以直接通过`域名/IP`来直接进行访问。不出意外会出现如下界面（如果出现不能访问的情况考虑是否是防火墙配置有问题，查看是否开发 8080 或者 80 端口）

由于后边我们需要配置 `nginx` 进行反向代理以及配置 `ssl` 证书来实现 `https` 方式访问，因此在看到 `solo` 启动正常之后，此处创建的 `solo` 镜像需要删除，等配置完 `nginx` 之后重新在创建一个。
删除 solo 容器直接执行下边命令

```sh
docker kill --name bolo
docker rm --name bolo
```

### 四：安装 `nginx`（可选）

安装之前为了后续配置 `nginx` 方便，我们需要在本地创建几个文件，用来挂载 `nginx` 的配置文件

```sh
# 切换到服务器根目录
cd /
# 创建主目录
mkdir dockerData
# 创建文件
mkdir dockerData/nginx dockerData/nginx/conf dockerData/nginx/logs dockerData/nginx/www dockerData/nginx/ssl
```

上边的文件目录名称可以任意，此处我使用 `dockerDate`

- `dockerData/nginx` 用于存放 `docker` 下 `nginx` 自定义文件
- `dockerData/nginx/conf` 存放 `nginx` 配置文件
- `dockerData/nginx/log` 存放 `nginx` 日志文件
- `dockerData/nginx/www`:存放 `nginx` 访问的资源文件
- `dockerData/nginx/ssl` 存放 `ssl` 证书

启动 `nginx`

```sh
docker run --name nginx -p 80:80 -d nginx
```

如果没有备案，80 端口可能是禁止访问的，因此可以可以将上边的 `80:80`换成 `8081:80`。命令执行完成之后，没有报错的话可以通过 `docker ps `来看 `nginx `是否正常运行，在运行的情况下访问的域名加上端口号查看是否正常安装，如果使用的 80 端口默认可以省略。出现如下界面表示安装成功。

导出配置文件：

```sh
docker cp nginx:/etc/nginx/nginx.conf /dockerData/nginx/conf/nginx.conf  #导出配置文件nginx.conf
docker cp nginx:/etc/nginx/conf.d /dockerData/nginx/conf/conf.d  #导出conf.d
cd /dockerData/nginx/ 
ls conf/   #查看配置文件是否导出成功
docker stop nginx  #删除刚才创建的nginx容器
docker rm nginx
```

重新创建一个 `nginx` 容器，挂载刚才本地导出的配置文件，便于后续更改 `nginx` 的配置信息

```sh
docker run -d -p 80:80 --name nginx \
-v /dockerData/nginx/conf/nginx.conf:/etc/nginx/nginx.conf \
-v /dockerData/nginx/conf/conf.d:/etc/nginx/conf.d \
-v /dockerData/nginx/www:/usr/share/nginx/html \
-v /dockerData/nginx/logs:/var/log/nginx nginx
```

- `-v /dockerData/nginx/conf/nginx.conf:/etc/nginx/nginx.conf` : 挂载配置文件 `nginx.conf`
- `-v /dockerData/nginx/conf/conf.d:/etc/nginx/conf.d`: 挂载配置文件 `default.conf`
- `-v /dockerData/nginx/www:/usr/share/nginx/html` : 挂载项目文件
- `-v /dockerData/nginx/logs:/var/log/nginx` : 挂载配置文件

### 五：配置 `ssl `证书（可选）

从 `http` 升级到 `https` 只需要在 `nginx` 中配置一个证书即可，一般性的 `ssl` 证书是可以免费申请的

配置 `nginx` 配置文件

大家可以参考我的配置文件进行配置，配置自己的 `default.conf `文件

```sh
worker_processes  1;

events {
    worker_connections  1024;
}

http {
	upstream backend {
        server localhost:8080; # 定义后端服务器做负载均衡
    }
    # 监听 HTTPS 端口并代理请求到 http://公网IP:8080
    server {
        listen 443 ssl;
        server_name www.hostname.com;

        ssl_certificate     /ssl/你的SSL证书.pem; # SSL 证书路径
        ssl_certificate_key /ssl/你的SSL证书.key; # SSL 证书私钥路径
        ssl_protocols TLSv1 TLSv1.1 TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers on;

        location / {
            proxy_pass http://公网IP:8080/; 
            proxy_set_header HOST $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            client_max_body_size 100m;
        }
    }
    server {
        listen 80;
        server_name www.hostname.com;

        # 自动将 HTTP 重定向到 HTTPS
        return 301 https://$host$request_uri;
    }
}
```

**注意**:上边的配置文件只是参考，要根据自己的服务器做出相应更改。

由于我们现在用的 `nginx` 容器并未监听 `443` 端口，所以需要删除现在的容器，重新启动一个新的 `nginx` 容器

```sh
#先删除原来的nginx容器
docker stop nginx;
docker rm nginx;

#创建新的nginx容器(一般默认映射HTTP端口80,HTTPS端口443即可)
docker run -d -p 80:80 -p 443:443 --name nginx \
-v /dockerData/nginx/conf/nginx.conf:/etc/nginx/nginx.conf \
-v /dockerData/nginx/conf/conf.d:/etc/nginx/conf.d \
-v /dockerData/nginx/ssl:/ssl/ \
-v /dockerData/nginx/www:/usr/share/nginx/html \
-v /dockerData/nginx/logs:/var/log/nginx nginx

#创建新的solo容器并映射到8080端口，用上边的nginx进行反向代理
docker run --detach --name bolo --network=host \
--env RUNTIME_DB="MYSQL" \
--env JDBC_USERNAME="root" \
--env JDBC_PASSWORD="123456" \
--env JDBC_DRIVER="com.mysql.cj.jdbc.Driver" \
--env JDBC_URL="jdbc:mysql://120.55.42.140:3306/solo?useUnicode=yes&characterEncoding=UTF-8&useSSL=false&serverTimezone=UTC" \
tangcuyu/bolo-solo --listen_port=8080 --server_scheme=https --server_host=www.hostname.com(域名/IP地址) --server_port=443
```

- `--server_scheme=http` 换成 `--server_scheme=https` 即可
- `--server_port`：最终访问端口，使用浏览器默认的 `80` 或者 `443` 的话值留空即可

重启 `nginx`，`docker restart nginx`,然后用浏览器访问 `https://域名`


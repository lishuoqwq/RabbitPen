---
title: 使用Rsync进行Linux同步到Windows Server2019服务器备份
published: 2025-04-17
pinned: true
description: 记录一次Rsync异地备份的过程
tags: [Linux,Windows,备份]
category: backup
author: Bunny
draft: false
date: 2025-01-30
image: https://picture.whgd.eu.org/file/1737528308553_【动漫男孩】2024-09-12 16_07_00.png
pubDate: 2025-01-30
---

### 一、Linux配置

#### 1、rsync 通常预装在大多数 Linux 发行版上。但是，如果未安装，您可以使用以下命令进行安装

```sh
apt update
apt install rsync
rsync --version
```

#### 2、编写配置文件

rsync 涉及到的配置主要有三个：

- /etc/rsyncd.conf -> 对 rsync 服务进行配置
- /tmp/rsync -> 待同步的目标目录，路径可以自定义
- /etc/rsyncd.passwd ->里面包含用于进行密码验证的账号信息

#### 3、/etc/rsyncd.conf 的配置

```sh
# 备份模块配置（后续需要引用这个backup别名）
[backup]

# 需要备份的文件路径
path = /data/docker-data/volumes 

# 访问的用户名
auth users = admin 

# 创建的密码指向
secrets file = /etc/rsyncd.passwd 
```

#### 4、创建用户和密码

```sh
# 创建文件夹
vim /etc/rsyncd.passwd

# 写入密码
echo "root:123456" > /etc/rsyncd.passwd

#更改文件权限
chmod 600 /etc/rsyncd.passwd
```

#### 5、查看rsync状态并手动启动

```sh
# 查看rsync状态
systemctl status rsyncd

# 看到这个则表示服务处于运行状态
● rsync.service - fast remote file copy program daemon
     Loaded: loaded (/lib/systemd/system/rsync.service; enabled; vendor preset: enabled)
     Active: active (running)

# 启动 rsync 服务：
systemctl start rsync

# 设置开机自启
systemctl enable rsync
```

### 二、Windows 配置

#### 1、下载 cwrsync 

```sh
# cwRsyncServer_4.1.0_Installer.exe安装即可
https://www.itefix.net/cwrsync-free-edition
```

#### 2、本地的Linux向本地的Winodws上传输数据执行命令

##### 1、进入ICW文件中配置rsyncd.conf文件

```sh
[backup]
path = /cygdrive/d/rsync_backup_teable/teable_backup
read only = false
transfer logging = yes
ignore errors
# 客户端请求显示模块列表时，该模块是否显示出来
list = no
# 允许所有的IP进行访问
hosts allow = * 
# auth users = admin
# secrets file = rsync.password
```

##### 2、在Linux上配置定时同步的cron

```sh
0 * * * * date >> /var/log/rsync_backup.log && rsync -avz /var/lib/docker/volumes admin@10.135.40.201::backup --delete >> /var/log/rsync_backup.log 2>&1
```

##### 3、查看系统cron运行日志

```sh
grep CRON /var/log/syslog | grep rsync
```

#### 3、云服务器上的Linux向本地的Winodws上传输数据执行命令

##### 1、修改云服务器上的配置文件 

```sh
# vim /etc/rsyncd.conf
[backup]
path = /data/docker-data/volumes
auth users = admin
secrets file = /etc/rsyncd.passwd
```

##### 2、修改云服务器连接rsync的通讯密码 vim /etc/rsyncd.passwd

```sh
admin:P@ssw0rd
```

##### 3、本地的Winodws上写一个bat脚本去定时运行备份

```sh
@echo off
set LOGFILE=D:/rsync_backup_teable/cloud_teable_backup_log.txt

echo Starting rsync backup at %DATE% %TIME% >> %LOGFILE%
rsync.exe -avz --port=873 --password-file=/cygdrive/d/rsync_backup_teable/cloud_teable_backup/rsyncpwd.txt < D:/rsync_backup_teable/ICW/password.txt admin@114.98.176.218::backup /cygdrive/d/rsync_backup_teable/cloud_teable_backup/volumes --delete >> %LOGFILE% 2>&1

echo Backup finished at %DATE% %TIME% >> %LOGFILE%
echo -------------------------------------------------------------------------------------------------------------------------------------------------- >> %LOGFILE%
```

##### 4、常见的参数

```sh
-a: 归档模式，使用递归传输并保持文件的属性
-v: 显示传输过程中的详细信息
-P: 显示文件传输的进度信息
-z: 传输中进行压缩，提高传输速度

--password-file： 登录时用到的密码文件，该文件直接把密码包含就可以，用户名需要显式指定
--exclude-from:  指定不需要进行传输的文件和文件夹
--delete: 在 exclude/include 规则生效后执行，假如服务器中文件比传入的文件多，则删除，少的话，则添加。
```

##### 5、解决出现下面错误：password file must not be other-accessible

```sh
@echo off
rsync.exe -avz --port=873 --password-file=/cygdrive/d/rsync_backup_teable/teable_backup/test/rsyncpwd.txt < D:/rsync_backup_teable/ICW/password.txt admin@114.98.176.218::backup /cygdrive/d/rsync_backup_teable/teable_backup/test --delete
pause
```

### 三、将rsync同步的备份文件进行定时打包，并保留15个备份

备份工作时间保持不变，检索时间段内，是则进行备份操作：

- 工作日（周一到周五）：8:00-18:00

- 周末（周六周日）：7:00-8:00、12:00-13:00、17:00-18:00

```bat
@echo off
setlocal EnableDelayedExpansion

REM 设置日志文件路径
set "BASE_DIR=D:\rsync_backup_teable"
set "LOG_DIR=%BASE_DIR%\teable_backup_tar"
set "LOG_FILE=%LOG_DIR%\backup_log.txt"

REM 创建基础目录和日志目录（如果不存在）
if not exist "%BASE_DIR%" mkdir "%BASE_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

REM 确保日志文件存在
if not exist "%LOG_FILE%" type nul > "%LOG_FILE%"

REM 记录开始时间
echo ========================================== >> "%LOG_FILE%"
echo 开始执行备份 %date% %time%
echo 开始执行备份 %date% %time% >> "%LOG_FILE%"

REM 检查是否为工作日（周一到周五）
for /f %%a in ('wmic path win32_localtime get dayofweek ^| findstr /r [0-6]') do set DOW=%%a

REM 使用 WMIC 获取系统时间
for /f "skip=1" %%a in ('wmic path win32_localtime get hour^,minute /format:value') do (
    for /f "tokens=1,2 delims==" %%b in ("%%a") do (
        if "%%b"=="Hour" set "CURRENT_HOUR=%%c"
        if "%%b"=="Minute" set "CURRENT_MINUTE=%%c"
    )
)

REM 确保变量不为空
if not defined CURRENT_HOUR set "CURRENT_HOUR=0"
if not defined CURRENT_MINUTE set "CURRENT_MINUTE=0"

REM 记录当前时间到日志
echo 当前系统时间: !CURRENT_HOUR!时!CURRENT_MINUTE!分
echo 当前系统时间: !CURRENT_HOUR!时!CURRENT_MINUTE!分 >> "%LOG_FILE%"

REM 检查是否在允许备份的时间段内
set "ALLOW_BACKUP=0"

REM 工作日（周一到周五）判断
if %DOW% LSS 6 (
    REM 工作日 8:00-18:00
    if !CURRENT_HOUR! GEQ 8 if !CURRENT_HOUR! LSS 18 (
        set "ALLOW_BACKUP=1"
    )
) else (
    REM 周末特定时间段判断
    REM 7:00-8:00
    if !CURRENT_HOUR!==7 set "ALLOW_BACKUP=1"
    REM 12:00-13:00
    if !CURRENT_HOUR!==12 set "ALLOW_BACKUP=1"
    REM 17:00-18:00
    if !CURRENT_HOUR!==17 set "ALLOW_BACKUP=1"
)

REM 如果不在允许的时间范围内，退出
if !ALLOW_BACKUP!==0 (
    if %DOW% GEQ 6 (
        echo 当前是周末，不在指定的备份时间段内 ^(当前时间: !CURRENT_HOUR!时!CURRENT_MINUTE!分^)
        echo 周末备份时间段为：7-8点、12-13点、17-18点
        echo 当前是周末，不在指定的备份时间段内 ^(当前时间: !CURRENT_HOUR!时!CURRENT_MINUTE!分^) >> "%LOG_FILE%"
        echo 周末备份时间段为：7-8点、12-13点、17-18点>> "%LOG_FILE%"
        timeout /t 3 > nul
        exit /b 0
    ) else (
        echo 当前是工作日，不在工作时间内 ^(当前时间: !CURRENT_HOUR!时!CURRENT_MINUTE!分^)
        echo 工作日备份时间为：8-18点
        echo 当前是工作日，不在工作时间内 ^(当前时间: !CURRENT_HOUR!时!CURRENT_MINUTE!分^) >> "%LOG_FILE%"
        echo 工作日备份时间为：8-18点 >> "%LOG_FILE%"
        timeout /t 3 > nul
        exit /b 0
    )
)

REM 源目录 (要压缩的目录)
set "SOURCE_DIR=%BASE_DIR%\teable_backup"
REM 目标目录 (存放压缩包的目录)
set "DESTINATION_DIR=%BASE_DIR%\teable_backup_tar"

REM 创建源目录和目标目录（如果不存在）
if not exist "%SOURCE_DIR%" (
    mkdir "%SOURCE_DIR%"
    echo 创建源目录: %SOURCE_DIR%
    echo 创建源目录: %SOURCE_DIR% >> "%LOG_FILE%"
)

if not exist "%DESTINATION_DIR%" (
    mkdir "%DESTINATION_DIR%"
    echo 创建目标目录: %DESTINATION_DIR%
    echo 创建目标目录: %DESTINATION_DIR% >> "%LOG_FILE%"
)

REM 备份数量
set "MAX_BACKUPS=15"

REM 索引文件，用于记录下一个要替换的文件编号
set "INDEX_FILE=%DESTINATION_DIR%\last_backup_index.txt"

REM 确保索引文件存在
if not exist "%INDEX_FILE%" echo 1 > "%INDEX_FILE%"

REM 获取当前日期时间 (用于压缩包名称)
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set "dt=%%a"
set "YEAR=%dt:~0,4%"
set "MONTH=%dt:~4,2%"
set "DAY=%dt:~6,2%"
set "HOUR=%dt:~8,2%"
set "MINUTE=%dt:~10,2%"
set "SECOND=%dt:~12,2%"

set "TIMESTAMP=%YEAR%%MONTH%%DAY%%HOUR%%MINUTE%%SECOND%"

REM 读取上一个备份使用的索引号
if exist "%INDEX_FILE%" (
    for /f "usebackq delims=" %%i in ("%INDEX_FILE%") do set "LAST_INDEX=%%i"
) else (
    set "LAST_INDEX=1"
)

REM 计算下一个要使用的索引号
set /a "NEXT_INDEX=(%LAST_INDEX% %% %MAX_BACKUPS%) + 1"

REM 构建压缩包名称
set "ARCHIVE_NAME=teable_backup_%TIMESTAMP%_%NEXT_INDEX%.tar"
set "ARCHIVE_PATH=%DESTINATION_DIR%\%ARCHIVE_NAME%"

REM 构建旧的压缩包名称
set "OLD_ARCHIVE_NAME="
for /f "delims=" %%f in ('dir /b /a-d "%DESTINATION_DIR%\teable_backup_*_%NEXT_INDEX%.tar" 2^>nul') do (
    set "OLD_ARCHIVE_NAME=%%f"
    goto :found_old_archive
)

:found_old_archive

if defined OLD_ARCHIVE_NAME (
    set "OLD_ARCHIVE_PATH=%DESTINATION_DIR%\%OLD_ARCHIVE_NAME%"
) else (
    set "OLD_ARCHIVE_PATH="
)

REM 检查源目录是否为空
dir /b /a "%SOURCE_DIR%\*" >nul 2>&1
if errorlevel 1 (
    echo 源目录为空或不可访问: %SOURCE_DIR%
    echo 源目录为空或不可访问: %SOURCE_DIR% >> "%LOG_FILE%"
    timeout /t 3 > nul
    exit /b 1
)

REM 删除旧的压缩包，如果存在
if defined OLD_ARCHIVE_PATH (
    echo 删除旧的压缩包: !OLD_ARCHIVE_PATH!
    echo 删除旧的压缩包: !OLD_ARCHIVE_PATH! >> "%LOG_FILE%"
    del /f /q "!OLD_ARCHIVE_PATH!" 2>nul
)

REM 使用 Windows tar 命令创建压缩包
echo 正在创建压缩包: !ARCHIVE_PATH!
echo 正在创建压缩包: !ARCHIVE_PATH! >> "%LOG_FILE%"
tar -cvf "!ARCHIVE_PATH!" -C "%SOURCE_DIR%" .
if !ERRORLEVEL! neq 0 (
    echo 创建压缩包失败
    echo 创建压缩包失败 >> "%LOG_FILE%"
    timeout /t 3 > nul
    exit /b 1
)

echo 压缩包创建成功: !ARCHIVE_PATH!
echo 压缩包创建成功: !ARCHIVE_PATH! >> "%LOG_FILE%"

REM 更新索引文件
echo !NEXT_INDEX! > "%INDEX_FILE%"

echo 备份完成
echo 备份完成 >> "%LOG_FILE%"
echo ========================================== >> "%LOG_FILE%"

REM 等待3秒后关闭窗口
timeout /t 3 > nul

endlocal
exit /b 0
```








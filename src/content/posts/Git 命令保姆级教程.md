---
title: Git 命令保姆级教程
published: 2026-02-04
pinned: true
description: 从零开始学习 Git，涵盖安装、配置、常用命令、分支管理、远程操作等全面内容
category: Linux
author: Bunny
image: https://picture.whgd.eu.org/file/1770209822177_【哲风壁纸】8k-二次元-动漫.png
---

# Git 命令保姆级教程

## Git 是什么

Git 就像是代码的"时光机"，可以随时回到以前的版本。

### 举个生活中的例子

你在写一篇论文：
- **没有 Git**：保存成「论文最终版」「论文最终版2」「论文真的最终版」「绝对不改版」... 文件乱七八糟
- **有 Git**：一个文件，随时可以回到任何历史版本，清清爽爽

### 为什么要学 Git

- 代码丢了？不怕，随时回退
- 改错了？不怕，一键撤销
- 多人一起写代码？不会互相覆盖
- 谁改了什么？每条记录都有记载

---

## 一、安装 Git

### Windows 用户

1. 打开这个网站：[git-scm.com](https://git-scm.com/download/win)
2. 点击下载安装包
3. 双击安装，一路点击「下一步」就可以了

### 验证是否安装成功

打开命令行（按 Win+R，输入 cmd），输入：

```bash
git --version
```

如果看到版本号（比如 `git version 2.40.0`），恭喜你，安装成功了！

---

## 二、初次配置

安装好后，要先告诉 Git 你是谁，不然以后提交代码不知道是谁干的。

```bash
# 设置你的名字
git config --global user.name "你的名字"

# 设置你的邮箱
git config --global user.email "你的邮箱@example.com"
```

这样就配置好了！

---

## 三、Git 工作原理（超重要！）

Git 有三个区域，理解了这三个区，你就掌握了一半。

```
┌─────────┐    git add    ┌─────────┐    git commit   ┌─────────┐
│ 工作区   │  ────────>    │ 暂存区   │  ────────>      │ 仓库区   |
│ (写代码) │               │ (准备区) │                 │ (已保存) │
└─────────┘               └─────────┘                 └─────────┘
```

| 区域 | 是什么 | 对应命令 |
|------|--------|----------|
| 工作区 | 你正在改的代码 | 改代码的地方 |
| 暂存区 | 准备要提交的文件 | `git add` 后进入这里 |
| 仓库 | 已保存的版本历史 | `git commit` 后存到这里 |

### 简单类比

- **工作区** = 你的书桌，正在写的作业
- **暂存区** = 文件袋，准备交上去的作业
- **仓库** = 保险柜，所有已交的作业都保存在这里

---

## 四、最常用的命令

### 1️⃣ git init - 创建新仓库

在一个文件夹里运行这个命令，这个文件夹就被 Git "接管"了。

```bash
git init
```

### 2️⃣ git clone - 下载别人的项目

```bash
git clone https://github.com/用户名/项目名.git
```

就像把 GitHub 上的项目复制到你的电脑上。

### 3️⃣ git status - 查看当前状态

```bash
git status
```

这是**最常用的命令**！随时用它来看看：
- 哪些文件被改了
- 哪些文件还没添加到暂存区
- 当前在哪个分支

**养成习惯：改代码前后都看一下 `git status`**

### 4️⃣ git add - 添加文件到暂存区

```bash
# 添加某个文件
git add 文件名.txt

# 添加所有文件
git add .

# 添加所有变化（包括删除的文件）
git add -A
```

### 5️⃣ git commit - 提交保存

```bash
git commit -m "说明你改了什么"
```

每次提交都要写清楚改了什么，方便以后查找。

#### 提交信息怎么写？

```
❌ 别这样写：
"fix bug"
"update"
"改完了"

✅ 这样写才好：
"修复登录按钮点击没反应的问题"
"添加用户头像上传功能"
"更新导航栏样式"
```

### 6️⃣ git log - 查看历史记录

```bash
# 简洁显示
git log --oneline

# 显示最近的 3 条
git log -3
```

---

## 五、常用操作指南

### 场景1：改错代码了，想撤销

```bash
# 撤销单个文件的修改（恢复到上一次提交的状态）
git checkout -- 文件名.txt

# 或者用新命令（推荐）
git restore 文件名.txt
```

### 场景2：add 错文件了，想从暂存区移除

```bash
git reset HEAD 文件名.txt
```

### 场景3：commit 信息写错了，想改

```bash
# 修改最后一次提交的信息
git commit --amend
```

### 场景4：想看看改了什么

```bash
# 查看还没 add 的修改
git diff

# 查看已经 add 的修改
git diff --staged
```

---

## 六、分支是什么？

分支就像是一个"平行宇宙"。

你在主分支（main）上，可以创建一个新分支（比如 feature/login），在新分支上写代码，写完了再合并回去。

**好处**：新功能开发不会影响主分支的稳定性。

### 分支常用命令

```bash
# 查看所有分支
git branch

# 创建并切换到新分支
git checkout -b 分支名

# 切换到已有分支
git checkout 分支名

# 删除分支
git branch -d 分支名
```

---

## 七、远程操作（配合 GitHub 使用）

### 把本地代码推送到 GitHub

```bash
# 第一次推送（需要设置关联）
git push -u origin main

# 后续推送
git push
```

### 从 GitHub 拉取最新代码

```bash
git pull
```

---

## 八、完整工作流程

### 新项目从零开始

```bash
# 1. 创建文件夹
mkdir my-project
cd my-project

# 2. 初始化 Git
git init

# 3. 创建文件并写代码
echo "# 我的第一个项目" > README.md

# 4. 添加文件
git add .

# 5. 提交
git commit -m "初始化项目"

# 6. 关联 GitHub 仓库（先在 GitHub 上创建仓库）
git remote add origin https://github.com/你的用户名/项目名.git

# 7. 推送
git push -u origin main
```

### 日常开发流程

```bash
# 1. 拉取最新代码
git pull

# 2. 改代码...

# 3. 查看改了什么
git status

# 4. 添加文件
git add .

# 5. 提交
git commit -m "写清楚你改了什么"

# 6. 推送
git push
```

---

## 九、常见问题解答

### Q1: 提示 "fatal: not a git repository"

**意思**：当前文件夹不是 Git 仓库

**解决**：运行 `git init`，或者确认你在这个项目文件夹里

### Q2: git add 后后悔了，想撤销

```bash
git reset HEAD 文件名
```

### Q3: push 时提示失败

**原因**：GitHub 上有别人推送的新代码，你的版本不是最新的

**解决**：先拉取，再推送

```bash
git pull
git push
```

### Q4: 怎么忽略某些文件？

创建一个叫 `.gitignore` 的文件，写进去要忽略的内容：

```
# 忽略所有 .pyc 文件
*.pyc

# 忽略 node_modules 文件夹
node_modules/

# 忽略配置文件（里面有密码）
config.ini

# 忽略日志文件
*.log
```

### Q5: 代码改错了，怎么找回旧版本？

```bash
# 查看某个版本的文件内容
git show HEAD:文件名.txt

# 恢复文件到某个版本
git checkout HEAD -- 文件名.txt
```

---

## 十、小技巧

### 1. 设置命令别名（偷懒神器）

把长命令变短命令：

```bash
# 设置别名
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit

# 以后可以用短命令了
git st        # 等同于 git status
git co main   # 等同于 git checkout main
git br        # 等同于 git branch
```

### 2. 快捷键

| 按键 | 作用 |
|------|------|
| q | 退出查看日志界面 |
| 方向键 | 上下翻动 |
| /关键词 | 搜索内容 |

---

## 最后的建议

1. **多提交**：写完一个小功能就提交，不要堆一大堆
2. **写清楚说明**：让别人（和未来的自己）一眼就知道改了什么
3. **多用分支**：新功能在新分支开发，别直接改主分支
4. **push 前先 pull**：减少冲突
5. **勤用 git status**：随时知道当前状态

---

祝你 Git 用得顺手！🎉

---
title: GraphRAG搭建使用
published: 2024-07-30
pinned: true
description: GraphRAG的搭建和训练
category: AI
author: Bunny
draft: false
date: 2025-01-20
image: https://picture.whgd.eu.org/file/1738589472975_【哲风壁纸】动物-可爱-围栏.png
pubDate: 2026-01-30
---

##### 1、本地安装Ollama，下载两个模型

```sh
ollama pull llama3.1

ollama pull nomic-embed-text
```

##### 2、安装清华大学的Anaconda环境，选择最新版本安装即可

##### 3、在Anaconda Powershell创建独立的虚拟环境

```sh
创建独立的虚拟环境
conda create -n  Graphrag1 python=3.11

进入创建的虚拟环境
conda activate Graphrag1

安装版本graphrag v0.2.1版本
pip install graphrag==0.2.1

在文档中创建一个graphragtest后运行下面的指令
mkdir -p ./ragtest/input

将所需的文档放入input中

初始化文档，进入目录graphragtest目录下
pip install future
python -m graphrag.index --init --root ./ragtest

修改文件
替换C:\Users\Admin\Documents\graphragtest\ragtest\settings.yaml
替换C:\Users\Admin\Documents\graphragtest1\ragtest\prompts\community_report.txt
替换C:\Users\Admin\anaconda3\envs\Graphrag1\Lib\site-packages\graphrag\query\llm\oai\embedding.py
替换C:\Users\Admin\anaconda3\envs\Graphrag1\Lib\site-packages\graphrag\llm\openai\openai_embeddings_llm.py

运行index指令
pip install ollama
python -m graphrag.index --root ./ragtest
出现All workflows completed successfully表示index解析完成

局部查询
python -m graphrag.query --root ./ragtest --method local "who is Scrooge, and what are his main relationships?"

全局查询
python -m graphrag.query --root ./ragtest --method global "what are the top themes in this story?"
```



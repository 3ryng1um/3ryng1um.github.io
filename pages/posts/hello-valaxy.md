---
title: "valaxy文章的基本信息"
date: "2025-10-23T14:14:00.000Z"
slug: "Hello-Valaxy"
categories: ["这是什么？"]
tags: ["？", "valaxy"]
excerpt: "115141919810"
---

[bookmark](https://3ryng1um.github.io/)


### frontmatter

- `title`: 文章标题
- `hide`: 你可以在文章头部添加 hide 属性，来临时隐藏某篇文章。（该文章仍然会被渲染）
    - `true` / `all`: 当设置为 `true` 或 `all` 时，该文章仍然会被渲染，你可以直接访问链接进行查看。但不会被显示在展示的文章卡片与归档中。
    - `index`: 设置为 `index` 时，将只在首页隐藏，归档中仍然展示。（譬如放一些没有必要放在首页的笔记，并在归档中方便自己查看。）
- categories/tags的并列分类：
    - categories:
    - [Linux]
    - [Tools]
    
    并列+子分类：
    categories:
    - [Linux, Hexo]
    - [Tools, PHP]

### 存储图片


Notion 的图片链接不是长期永久可用的公开静态链接，**需要尽快在抓取时把图片下载并重新托管（本地或别的 CDN）**，否则会出现无法访问或签名无效的问题

- `notion-to-md` 把 Notion 页面里的图片块转成 Markdown 图片语法（`![alt](<Notion-signed-URL>)`）或把图片 URL 写进生成的 markdown。**通常不会**自动把图片下载并保存到你站点的 `public` 目录
- 因此常见做法是在导出流程里 **抓取这些图片并把 markdown 中的 URL 替换为你本地/你自己的 CDN URL**。

引用的文章要放在授权的database里，不然图片下载不了


### 站点更新命令


| 命令             | 作用                  | 通常使用场景         |
| -------------- | ------------------- | -------------- |
| `pnpm fetchno` | 从 Notion 拉取文章       | 自动同步 Notion 内容 |
| `pnpm dev`     | 启动本地预览开发服务器         | 实时预览           |
| `pnpm build`   | 本地构建静态网站（默认 SSG 模式） | 不直接上传到GitHub   |
| `pnpm rss`     | 生成 RSS 订阅文件         | 发布更新后生成订阅源     |
| `pnpm serve`   | 本地预览打包结果            | 检查构建后页面        |
| `pnpm new`     | 创建新文章               | 新建文章时使用        |


### 高频修改的配置文件


在fetchnotion脚本中，标题下调，标题字号大小定义在custom.scss


site.config.ts站点基本信息


fetch-notion.cjs发布文章的配置


gh-pages.yml GitHub workflow



将敏感信息（如 `NOTION_TOKEN` 和 `NOTION_DATABASE_ID`）存储在 GitHub Secrets 中


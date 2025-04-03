---
title: Hello, Valaxy!
hide: index
date: 2022-04-01
updated: 2022-04-01
categories: 这是什么？
tags:
  - valaxy
  - 笔记
---

## ymal格式的frontmatter
摘摘又要要。
<!-- more -->
title: 文章标题
hide: 你可以在文章头部添加 hide 属性，来临时隐藏某篇文章。（该文章仍然会被渲染）
  true / all: 当设置为 true 或 all 时，该文章仍然会被渲染，你可以直接访问链接进行查看。但不会被显示在展示的文章卡片与归档中。
  index: 设置为 index 时，将只在首页隐藏，归档中仍然展示。

并列分类：(tags也一样)
categories:
- [Linux]
- [Tools]

并列+子分类：
categories:
- [Linux, Hexo]
- [Tools, PHP]
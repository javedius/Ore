<div align="center">

# Ore

**轻量级跨平台 SQLite 编辑器，支持 macOS、Windows 和 Linux。**

[English](README.md) · [Русский](README.ru.md) · [简体中文](README.zh-CN.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)
[![Made with Tauri](https://img.shields.io/badge/made%20with-Tauri%202-FFC131)](https://tauri.app)

<img src="docs/screenshot-dark.png" width="820" alt="Ore — 数据表格（深色主题）">

<p><sub>主窗口：架构树、可编辑表格、单元格右键菜单。另有<a href="docs/screenshot-light.png">浅色主题</a>。</sub></p>

<img src="docs/mascot.png" width="120" alt="Mo —— 矿工鼹鼠，Ore 的吉祥物">

<p><sub>认识一下 <strong>Mo</strong> —— 矿工鼹鼠，它替你挖矿。</sub></p>

</div>

## 为什么做 Ore

Ore 只围绕一件事：**用最少的步骤打开 SQLite 文件并查看、修改数据** —— 一个约 10 MB 的原生小应用，而不是浏览器标签页或沉重的 IDE。

- 通过对话框或拖放，秒开 `.db / .sqlite / .sqlite3` 文件
- 真正的桌面应用：原生菜单、系统 WebView，不使用 Electron
- 读写安全：每次修改都是基于 `rowid` 的参数化 `UPDATE`，CSV 导入在单个事务中执行并支持回滚

## 功能

- **架构树** —— 数据表（含列、类型、主键标记）、视图、索引、触发器、行数统计
- **数据表格** —— 每页 50 行，点击表头排序，双击编辑单元格，`Set NULL`，复制单元格 / 整行为 JSON / CSV，插入和删除行
- **列筛选** —— 默认子串匹配，前缀运算符 `=`、`>`、`<` 用于精确与数值比较
- **SQL 控制台** —— ⌘/Ctrl+Enter 运行，结果以表格展示，错误信息直接来自 SQLite，查询历史跨会话保留
- **CSV 导入** —— 预览、分隔符选择（`,` `;` 制表符 `|`）、按数据推断类型新建表，或映射到现有表；空字段存为 `NULL`，整个导入是一个事务
- **导出** —— 表（遵循当前筛选）或查询结果导出为 CSV / JSON
- **深色与浅色主题**；视图和 `WITHOUT ROWID` 表以只读方式打开

## 下载

前往 [Releases](https://github.com/javedius/Ore/releases) 获取安装包：
`.dmg`（Apple Silicon + Intel）、`.msi` / `.exe`（NSIS）以及 `.AppImage` / `.deb` / `.rpm`。

> 安装包按标签（tag）自动构建。在首个标签发布之前，请从源码构建（见下文）。
> macOS 构建暂未签名 —— 首次启动请右键 → 打开（Gatekeeper 提示）。

## 从源码构建

前提条件：[Node.js 20+](https://nodejs.org)、[Rust](https://rustup.rs)，以及 [Tauri 平台要求](https://tauri.app/start/prerequisites/)（macOS 需要 Xcode CLT，Windows 需要 MSVC，Linux 需要 webkit2gtk）。

```bash
git clone https://github.com/javedius/Ore.git
cd Ore/app
npm install
npm run tauri dev     # 以热重载方式运行
```

生产构建：`npm run tauri build`。
后端单元测试：`cd app/src-tauri && cargo test`。

## 技术栈

| 层        | 选型                                            |
|-----------|----------------------------------------------------|
| 外壳      | Tauri 2（系统 WebView，Rust 核心）                |
| 数据库    | rusqlite + 内置 SQLite（无系统依赖）              |
| 前端      | React 19 + TypeScript + Vite                      |
| 设计      | 自研 “Caliper” 设计系统 —— 扁平、细线、青绿点缀   |

前端不会为数据修改拼 SQL：所有语句由 Rust 端生成，并对表名、列名做白名单校验，数据按页流式返回。

## 项目结构

```
app/src           React UI（设计令牌位于 src/styles）
app/src-tauri     Rust 后端：rusqlite、IPC 命令
docs              截图
demo              演示数据库（shop.db）与用于试用导入的 CSV
```

## 参与贡献

欢迎 Issue 和 Pull Request！可以从 issue 列表挑选任务，或提出自己的想法。开发环境搭建见[从源码构建](#从源码构建)。界面文案与代码注释请使用英文。

## 许可证

[MIT](LICENSE)。内置 SQLite 属于公有领域（public domain）。

---

<div align="center">
<sub>Ore —— 矿石：原材料中蕴藏的价值。</sub>
</div>

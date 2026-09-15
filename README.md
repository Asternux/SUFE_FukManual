# SUFE 课程选择执行器

基于 TypeScript 与 Playwright 的上海财经大学 EAMS 本地选课流程自动化项目。

> **说明**：程序沿学校网页的正常操作链工作，重点保证流程可靠、状态判断正确、容易排查问题。项目不包含学校账号、密码、Cookie、Session、Token、学号、姓名或任何登录缓存。

## 🚀 快速开始

### 📥 下载与安装

**Windows 用户（推荐）**：
- 从 [Releases](https://github.com/Asternux/SUFE_FukManual/releases/latest) 下载 `Windows-x64-portable` 版本
- 解压到固定文件夹即可使用，自带 Node.js 运行时

**源码用户**（需要 Node.js 20+）：
```powershell
pnpm install --frozen-lockfile
pnpm build
# 复制配置模板
Copy-Item config/courses.example.json config/courses.json
```

### 📖 使用步骤（Windows 小白版）

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 完整解压 ZIP 到固定文件夹 | 重要：不要放在临时文件夹 |
| 2 | 双击 `0_打开使用说明.cmd` | 阅读离线使用说明 |
| 3 | 双击 `1_首次环境检查.cmd` | 验证系统环境 |
| 4 | 双击 `2_填写课程.cmd` | 配置目标课程 |
| 5 | 双击 `3_只读检查.cmd` | 验证配置（不产生提交） |
| 6 | 双击 `4_实战运行.cmd` | 执行真实选课 |
| 7 | 双击 `5_查看最近结果.cmd` | 查看运行结果 |

**⚠️ 关键点**：
- `3_只读检查` 仅验证配置，**不会提交**
- `4_实战运行` **可能产生真实选课操作**
- 配置文件默认禁用提交（`submission.enabled=false`）
- 实战入口仅生成一次性启用配置

## ✨ 主要功能

- ✅ 通过 JSON 或交互式向导一次配置多个教学班
- ✅ 支持 Chrome 或 Microsoft Edge 浏览器
- ✅ 自动解析教学班并检查歧义
- ✅ 多课程独立并行处理（同一教学班始终单一提交）
- ✅ 分离提交与验证流程（确保最终状态正确）
- ✅ 网络异常自动验证重试机制
- ✅ 登录失效时智能暂停与恢复
- ✅ 每门课独立日志 + 整体运行总结
- ✅ 完整的环境检查、配置向导和诊断工具

## 🔧 配置说明

### 入口配置

`entryUrl` 必须是当前轮次的完整选课入口，包含实际的 `electionProfile.id`。

### 课程匹配顺序

按以下优先级匹配目标课程：

1. `lessonId` - 课程系统 ID（最优先）
2. `lessonNo` - 教学班号/课程序号
3. `courseCode + teacher` - 课程代码 + 讲师
4. `name + teacher + time` - 课程名 + 讲师 + 上课时间

⚠️ 若匹配到多个教学班，程序会列出候选并停止，要求消除歧义。

### 调度优先级

`priority` 数值越小越优先执行。注意：
- 这不是"需等待前一门完成"的顺序
- 不同课程由独立 Worker 推进
- 课程间无强制依赖关系

### 重试策略

建议首次真实运行将 `retry.maxAttempts` 设为 `1`。程序特性：
- 强制最小重试间隔 ≥ 15 秒
- 每次提交后必验证最终状态
- 遵守服务器 `Retry-After` 头

## 📋 运行模式

### Inspect（只读验证）

```powershell
pnpm start -- --config config/courses.json --mode inspect
```

功能：
- 打开浏览器等待用户登录
- 检查教学班匹配、人数、已选状态、时间冲突
- 验证页面操作状态
- 输出 `READY` 后自动关闭

**关键**：此模式不产生任何提交操作

### Run（真实运行）

```powershell
pnpm start -- --config config/courses.json --mode run
```

前置条件：
- 在 `config/courses.json` 中设置 `submission.enabled: true`
- 若启用 `requireArmPhrase: true`，需在终端输入精确的 `ARM` 指令

#### 运行中命令

- `status` - 查看各课程当前状态
- `pause` - 暂停新的观察和提交（已开始的交易会完成验证）
- `resume` - 恢复运行
- `stop` - 停止所有未完成课程

#### 特殊状态

- `PENDING` - 选课尚未开放，Worker 等待页面真实开放
- 保持浏览器、终端、网络和电脑运行状态
- 达到 `scheduler.maxRunDuration` 后自动停止

## 🖥️ 系统要求

### 支持的环境

| 平台 | 版本 | 状态 | 说明 |
|------|------|------|------|
| Windows | 10/11 x64 | ✅ 正式支持 | 提供完整交付包，已验证 |
| macOS | - | ⚠️ 测试中 | 源码 CLI 可用，`.cmd` 不支持 |
| Linux | - | ⚠️ 测试中 | 源码 CLI 可用，`.cmd` 不支持 |

### 浏览器

- ✅ Google Chrome
- ✅ Microsoft Edge
- 用户必须完成正常登录（程序不处理验证码、手机验证、SSO 保护）

### 源码环境

- Node.js 20+
- pnpm 11+（v1.0.1 使用 pnpm 11.19.0 构建）
- Google Chrome 或 Microsoft Edge

## 🔒 安全设计

本项目采用严格的安全设计理念：

| 原则 | 说明 |
|------|------|
| 验证不信任 | HTTP 200、按钮点击、弹窗出现都不等于成功 |
| 双重确认 | Verifier 重新读取系统最终已选状态 |
| 限流遵守 | 重试次数和等待时间有上下限；服从服务器 `Retry-After` |
| 单一流程 | 每个教学班同时只有一个在途提交 |
| 无绕过 | 不提供验证码、认证、访问控制绕过功能 |
| 不滥用 | 不提供高频人数请求或请求洪泛功能 |

⚠️ **日志安全**：不要公开 `logs/`、`config/courses.json`、`.runtime/` 和浏览器数据。

## 📚 文档

- [系统与程序结构](docs/ARCHITECTURE.md)
- [验证范围与已知限制](docs/VALIDATION.md)
- [v1.0.1 发布说明](docs/RELEASE.md)
- [Windows 交付层维护说明](delivery/维护者说明.md)

## ⚖️ 使用条款

**本项目仅供学习和个人自动化研究使用**

- 遵守学校选课规则和网络服务条款
- 遵守当地法律法规
- 不承诺获得课程名额
- 不鼓励高频请求或无限并发

## 📄 License

[MIT](LICENSE)

---

**最后更新**：v1.0.1 | **报告问题**：[Issues](https://github.com/Asternux/SUFE_FukManual/issues)
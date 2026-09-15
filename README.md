# SUFE 课程选择执行器

基于 TypeScript 与 Playwright 的上海财经大学 EAMS 本地选课流程自动化项目。

> **说明**：程序沿学校网页的正常操作链工作，重点保证流程可靠、状态判断正确、容易排查问题。项目不包含学校账号、密码、Cookie、Session、Token、学号、姓名或任何登录缓存。

## 🚀 快速开始

### 📥 下载与安装

**Windows 用户（推荐）**：

- 从 [Releases](https://github.com/Asternux/SUFE_FukManual/releases/latest) 下载 `SUFE-Course-Executor-v1.0.2-Windows-x64-portable.zip`；
- 完整解压到固定文件夹，便携包自带 Node.js 运行时；
- 电脑仍需安装 Google Chrome 或 Microsoft Edge。

**源码用户**（需要 Node.js 20+）：

```powershell
pnpm install --frozen-lockfile
pnpm build
Copy-Item config/courses.example.json config/courses.json
```

### 📖 使用步骤（Windows 小白版）

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 完整解压 ZIP 到固定文件夹 | 不要放在临时文件夹 |
| 2 | 双击 `0_打开使用说明.cmd` | 阅读离线使用说明 |
| 3 | 双击 `1_首次环境检查.cmd` | 验证系统环境 |
| 4 | 双击 `2_填写课程.cmd` | 配置目标课程 |
| 5 | 双击 `3_只读检查.cmd` | 验证配置，不产生提交 |
| 6 | 双击 `4_实战运行.cmd` | 执行真实选课 |
| 7 | 双击 `5_查看最近结果.cmd` | 查看运行结果 |

**关键点**：

- `3_只读检查` 只读取页面状态，不会提交；
- `4_实战运行` 可能产生真实选课操作；
- 日常配置默认 `submission.enabled=false`；
- 实战入口只生成一次性启用配置，并在结束时清理；
- 实战确认要求先输入 `RUN`，到达 `READY` 后再输入精确的大写 `ARM`，确认区分大小写。

## ✨ 主要功能

- 通过 JSON 或交互式向导一次配置多个目标教学班；
- 支持 Chrome 或 Microsoft Edge，由用户完成正常网页登录；
- 自动解析教学班并阻断多候选歧义；
- 多课程独立 Worker 并行推进，同一教学班始终只有一个在途提交；
- 分离提交与 Verifier，只有最终已选状态明确时才判定成功；
- 网络异常或未知结果先验证，再按策略进行有界重试；
- 登录失效时暂停新的提交，恢复登录后继续读取状态；
- 每门课独立日志、整次运行总结、环境检查和脱敏诊断导出。

## 🔧 配置说明

`entryUrl` 必须是当前轮次的完整选课入口，并包含实际的 `electionProfile.id`。目标匹配顺序为：

1. `lessonId`；
2. `lessonNo`（教学班号/课程序号）；
3. `courseCode + teacher`；
4. `name + teacher + time`。

如果匹配到多个教学班，程序会列出候选并停止，要求先消除歧义。

`priority` 是调度优先级，数字越小越优先。它不是“必须等上一门完成才开始下一门”的顺序；不同课程由独立 Worker 推进，没有先后要求时可以全部填 `1`。

建议首次真实运行将 `retry.maxAttempts` 设为 `1`。程序强制最小重试间隔至少 15 秒，并在每次提交后先验证最终状态。

## 📋 运行模式

### Inspect（只读验证）

```powershell
pnpm start -- --config config/courses.json --mode inspect
```

Inspect 会打开浏览器并等待正常登录，然后检查教学班匹配、人数、已选状态、时间冲突和页面操作状态。输出 `READY` 后结束并自动关闭程序创建的浏览器；此模式不会提交。

### Run（真实运行）

```powershell
pnpm start -- --config config/courses.json --mode run
```

真实运行要求本地配置中的 `submission.enabled=true`。若 `requireArmPhrase=true`，终端还必须输入精确的大写 `ARM`。运行中支持 `status`、`pause`、`resume` 和 `stop`。

如果选课尚未开放，Worker 通常保持 `PENDING` 并等待页面真实开放；达到 `scheduler.maxRunDurationMs` 后，未完成课程会停止。浏览器、终端、网络和电脑需要保持运行。

## 🖥️ 系统要求

| 平台 | 状态 | 说明 |
|------|------|------|
| Windows 10/11 x64 | 正式支持 | 提供已完成实机和独立解压验证的交付包 |
| macOS/Linux | 源码测试中 | Windows `.cmd` 交付层不可直接使用 |

源码环境需要 Node.js 20+、pnpm 11（v1.0.2 使用 pnpm 11.19.0 构建）以及 Chrome 或 Edge。源码模式使用系统浏览器，通常不需要执行 `playwright install`；`browser.channel` 只支持 `chrome` 或 `msedge`。

## 🔒 安全设计

| 原则 | 说明 |
|------|------|
| 验证不信任 | HTTP 200、按钮点击、弹窗出现或请求完成都不等于成功 |
| 最终确认 | Verifier 重新读取系统最终已选状态 |
| 限流遵守 | 重试次数和等待时间有上下限，服从服务器 `Retry-After` |
| 单一流程 | 每个教学班同时只有一个在途提交 |
| 无绕过 | 不提供验证码、认证、访问控制或资格校验绕过功能 |
| 不滥用 | 不提供高频人数请求、极限频率或请求洪泛功能 |

日志保存在本地 `logs/`。不要公开 `logs/`、`config/courses.json`、`.runtime/`、浏览器目录或网页保存文件。

## 📚 文档

- [系统与程序结构](docs/ARCHITECTURE.md)
- [验证范围与已知限制](docs/VALIDATION.md)
- [v1.0.2 发布说明](docs/RELEASE.md)
- [Windows 交付层维护说明](delivery/维护者说明.md)

## ⚖️ 使用条款

本项目仅供学习和个人自动化研究使用。请遵守学校选课规则、网络服务条款和当地法律法规。项目不承诺获得课程名额，也不鼓励高频请求、无限并发或规避系统限制。

## 📄 License

[MIT](LICENSE)

---

**最后更新**：v1.0.2 · **报告问题**：[Issues](https://github.com/Asternux/SUFE_FukManual/issues)

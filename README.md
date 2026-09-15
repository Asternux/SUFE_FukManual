# SUFE Course Executor

基于 TypeScript 与 Playwright 的本地课程选择流程自动化实验项目。程序沿学校网页的正常操作链工作，重点保证状态判断、独立验证、有界重试和可追踪日志。

当前实现面向上海财经大学 EAMS 选课页面。项目不包含学校账号、密码、Cookie、Session、Token、学号、姓名或任何登录缓存。

## 主要能力

- 通过 JSON 一次配置多个目标教学班；
- 打开 Chrome 或 Microsoft Edge，由用户完成正常网页登录；
- 从已加载页面解析教学班并检查多候选歧义；
- 多课程 Worker 独立推进，同一教学班始终只有一个在途提交；
- 分离提交与 Verifier，只有最终已选状态明确时才判定成功；
- 网络异常或未知结果先验证，再决定是否进行有界重试；
- 登录失效时暂停提交，恢复登录后继续读取状态；
- 为每门课记录独立日志，并输出整次运行总结。

## 环境要求

- Node.js 20 或更高版本；
- pnpm；
- Google Chrome 或 Microsoft Edge；
- 已在 Windows 上验证。源码可能在 macOS/Linux 上运行，但 v1.0.0 未做完整实机验收。

项目使用系统中已有的 Chrome/Edge，因此通常不需要执行 `playwright install`。`browser.channel` 只支持 `chrome` 或 `msedge`。

## 安装

```powershell
pnpm install
pnpm build
```

复制示例配置，并只在本地编辑副本：

```powershell
Copy-Item config/courses.example.json config/courses.json
```

`config/courses.json` 已被 `.gitignore` 排除，不应提交或分享。

## 配置

`entryUrl` 必须是当前轮次的完整选课入口，并包含本地实际使用的 `electionProfile.id`。课程匹配顺序为：

1. `lessonId`
2. `lessonNo`
3. `courseCode + teacher`
4. `name + teacher + time`

如果匹配到多个教学班，程序会列出候选并停止，要求用户先消除歧义。`priority` 数字越小越靠前；相同优先级允许多门课程同时填写，它们仍由独立 Worker 推进。

## Inspect 只读检查

```powershell
pnpm start -- --config config/courses.json --mode inspect
```

Inspect 会打开浏览器并等待正常登录，然后检查教学班匹配、人数、已选状态、时间冲突和页面操作状态。它不会进入真实提交阶段。

## 正式运行

真实提交默认关闭。确认 Inspect 输出无误后，在本地配置中主动将 `submission.enabled` 改为 `true`：

```powershell
pnpm start -- --config config/courses.json --mode run
```

若 `requireArmPhrase` 为 `true`，还必须在终端输入精确的 `ARM`。运行中支持 `pause`、`resume`、`status` 和 `stop`。

## 安全设计

- HTTP 200、按钮点击、弹窗出现或请求完成都不等于选课成功；
- Verifier 会重新读取系统的最终已选状态；
- timeout 或未知结果不会触发立即重复提交；
- 每个教学班只有一个在途提交；
- 重试次数和最小等待时间都有上限与下限；
- 服务器返回 `Retry-After` 或明确限流信息时，程序服从更长的等待；
- 程序不提供验证码绕过、认证绕过、访问控制绕过、资格校验篡改或请求洪泛功能。

日志保存在本地 `logs/`。不要公开日志、`config/courses.json`、`.runtime/`、浏览器目录或网页保存文件。

## 文档

- [系统与程序结构](docs/ARCHITECTURE.md)
- [验证边界](docs/VALIDATION.md)
- [v1.0.0 发布说明](docs/RELEASE.md)

## 使用边界

本项目仅供学习和个人自动化研究。使用者应遵守学校的选课规则、网络服务规则和当地法律。项目不承诺获得课程名额，也不鼓励高频请求、无限并发或规避系统限制。

## License

[MIT](LICENSE)

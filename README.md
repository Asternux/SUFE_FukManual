# SUFE Course Executor

基于 TypeScript 与 Playwright 的本地课程选择流程自动化实验项目。程序沿学校网页的正常操作链工作，重点保证流程可靠、状态判断正确、容易排查问题。

当前实现面向上海财经大学 EAMS 选课页面。项目不包含学校账号、密码、Cookie、Session、Token、学号、姓名或任何登录缓存。

## 下载方式

普通 Windows 用户建议从 [Releases](https://github.com/Asternux/SUFE_FukManual/releases/latest) 下载名称含 `Windows-x64-portable` 的 ZIP。该版本自带 Node.js 运行时和所需生产依赖，解压后按编号双击即可。

仓库源码适合希望阅读、审计或自行构建的人。标准 Windows ZIP 不包含 Node.js，目标电脑需要已安装 Node.js 20 或更高版本。

## 主要能力

- 通过 JSON 或交互式向导一次配置多个目标教学班；
- 打开 Chrome 或 Microsoft Edge，由用户完成正常网页登录；
- 从已加载页面解析教学班并检查多候选歧义；
- 多课程 Worker 独立推进，同一教学班始终只有一个在途提交；
- 分离提交与 Verifier，只有最终已选状态明确时才判定成功；
- 网络异常或未知结果先验证，再决定是否进行有界重试；
- 登录失效时暂停提交，恢复登录后继续读取状态；
- 为每门课记录独立日志，并输出整次运行总结；
- 提供 Windows 环境检查、配置向导、只读检查、安全实战入口、结果查看和诊断导出。

## 小白使用流程

1. 下载 `SUFE-Course-Executor-v1.0.1-Windows-x64-portable.zip`，完整解压到一个固定文件夹。
2. 双击 `0_打开使用说明.cmd` 阅读离线说明。
3. 双击 `1_首次环境检查.cmd`。
4. 双击 `2_填写课程.cmd`，粘贴当前轮次选课主页网址并填写目标课程。
5. 双击 `3_只读检查.cmd`，在打开的浏览器中正常登录，核对课程、人数、已选状态和冲突。
6. 需要真实执行时双击 `4_实战运行.cmd`，先核对课程清单并输入 `RUN`。
7. 浏览器完成登录和预检查后，终端会要求输入 `ARM`；输入后才进入真实运行。
8. 结束后双击 `5_查看最近结果.cmd`。

`3_只读检查` 不会提交。`4_实战运行` 可能产生真实选课操作。日常配置始终保存为 `submission.enabled=false`，实战入口只生成一次性启用配置，并在结束时删除。

## 浏览器与系统

- 支持 Google Chrome 和 Microsoft Edge；
- Windows 10/11 x64：提供正式小白交付包，已完成实机与独立解压验证；
- macOS/Linux：源码 CLI 尚未完成正式实机验收，Windows `.cmd` 交付层不可直接使用；
- 浏览器必须由用户完成正常登录，程序不处理或绕过验证码、手机验证与 SSO 保护。

源码模式使用系统中已有的 Chrome/Edge，因此通常不需要执行 `playwright install`。`browser.channel` 只支持 `chrome` 或 `msedge`。

## 源码环境

- Node.js 20 或更高版本；
- pnpm 11（v1.0.1 使用 pnpm 11.19.0 构建）；
- Google Chrome 或 Microsoft Edge。

安装和构建：

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

复制示例配置，并只在本地编辑副本：

```powershell
Copy-Item config/courses.example.json config/courses.json
```

`config/courses.json` 已被 `.gitignore` 排除，不应提交或分享。

## 配置说明

`entryUrl` 必须是当前轮次的完整选课入口，并包含本地实际使用的 `electionProfile.id`。目标匹配顺序为：

1. `lessonId`
2. `lessonNo`（课程序号/教学班号）
3. `courseCode + teacher`
4. `name + teacher + time`

如果匹配到多个教学班，程序会列出候选并停止，要求用户先消除歧义。

`priority` 是调度优先级，数字越小越优先。它不是“必须等上一门完成才开始下一门”的顺序；不同课程仍由独立 Worker 推进。课程之间没有先后要求时，可以全部填 `1`。

建议首次真实运行将 `retry.maxAttempts` 设为 `1`。程序强制最小重试间隔至少 15 秒，并在每次提交后先验证最终状态。

## Inspect 只读检查

```powershell
pnpm start -- --config config/courses.json --mode inspect
```

Inspect 会打开浏览器并等待正常登录，然后检查教学班匹配、人数、已选状态、时间冲突和页面操作状态。输出 `READY` 后结束并自动关闭程序创建的浏览器，属于正常现象。

## 正式运行

真实提交默认关闭。确认 Inspect 输出无误后，在本地配置中主动将 `submission.enabled` 改为 `true`：

```powershell
pnpm start -- --config config/courses.json --mode run
```

若 `requireArmPhrase` 为 `true`，还必须在终端输入精确的 `ARM`。运行中支持：

- `status`：查看每门课程状态；
- `pause`：暂停新的观察和提交，已开始的页面事务会先完成验证；
- `resume`：恢复运行；
- `stop`：停止全部尚未完成的课程。

在选课尚未开放时，Worker 通常保持 `PENDING` 并等待页面真实开放。浏览器、终端、网络和电脑需要保持运行，电脑不能进入睡眠。达到 `scheduler.maxRunDurationMs` 后，未完成课程会进入 `STOPPED`。

## 安全设计

- HTTP 200、按钮点击、弹窗出现或请求完成都不等于选课成功；
- Verifier 会重新读取系统的最终已选状态；
- timeout 或未知结果不会触发立即重复提交；
- 每个教学班只有一个在途提交；
- 重试次数和最小等待时间都有上限与下限；
- 服务器返回 `Retry-After` 或明确限流信息时，程序服从更长的等待；
- 程序只复用页面已有的整轮人数映射，不为每门目标建立高频人数请求；
- 程序不提供验证码绕过、认证绕过、访问控制绕过、资格校验篡改或请求洪泛功能。

日志保存在本地 `logs/`。不要公开日志、`config/courses.json`、`.runtime/`、浏览器目录或网页保存文件。

## 文档

- [系统与程序结构](docs/ARCHITECTURE.md)
- [验证范围与已知限制](docs/VALIDATION.md)
- [v1.0.1 发布说明](docs/RELEASE.md)
- [Windows 交付层维护说明](delivery/维护者说明.md)

## 使用边界

本项目仅供学习和个人自动化研究。使用者应遵守学校的选课规则、网络服务规则和当地法律。项目不承诺获得课程名额，也不鼓励高频请求、无限并发或规避系统限制。

## License

[MIT](LICENSE)

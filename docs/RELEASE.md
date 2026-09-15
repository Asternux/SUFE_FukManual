# v1.0.2

v1.0.2 修复 Windows portable 实战启动器在 `READY` 后无法进入 ARM 确认的问题。Windows PowerShell 原先会捕获 Node.js 的标准输出，使 `stdout.isTTY` 失效；启动器现在让子进程继承控制台句柄，并准确转发退出码。

本次变更：

- 修复 portable 启动器的 ARM TTY 异常退出；
- stdout 与 stderr 继续显示在原控制台，启动器只接收整数退出码；
- 致命异常的脱敏 stack 同时写入 stderr 和运行日志；
- 增加 Windows 子进程输出与退出码回归测试；
- 明确 `ARM` 必须使用大写并区分大小写。

普通用户应下载名称含 `Windows-x64-portable` 的压缩包。便携包已经包含 Node.js 和 Playwright 生产依赖，但仍需要电脑安装 Chrome 或 Edge。

核心提交、验证、调度、并发、限频和重试策略均未改变。真实提交保持默认关闭；实战启动器创建一次性启用配置，结束后清理。

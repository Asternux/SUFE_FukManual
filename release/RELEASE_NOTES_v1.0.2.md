v1.0.2 修复 Windows x64 portable 版本在 `READY` 后进入 ARM 确认时异常退出的问题。

本次更新：

- 保留 Node.js 子进程的交互式控制台句柄；
- stdout、stderr 和退出码由 Windows 启动器正确转发；
- 致命异常的脱敏 stack 会写入运行日志，诊断包不再只停在 `READY`；
- 新增子进程输出与退出码回归测试；
- 明确安全确认必须输入精确的大写 `ARM`。

修复已通过实站 Inspect、`READY` 到 ARM 的无提交验证、30 项核心测试和 28 项 Windows 交付层测试。提交、Verifier、Worker、并发、限频和重试策略均未改变。

普通 Windows 用户建议下载 `SUFE-Course-Executor-v1.0.2-Windows-x64-portable.zip`。真实提交仍默认关闭，运行时继续要求 `RUN` 与大写 `ARM` 双重确认。

本项目仅供学习和个人自动化研究。请遵守学校规则、网络服务规则和当地法律。

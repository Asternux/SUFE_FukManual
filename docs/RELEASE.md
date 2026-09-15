# v1.0.1

v1.0.1 在已验收的 v1.0.0 核心执行器外增加 Windows 小白交付层，没有修改核心提交、验证、调度或状态机逻辑。

新增内容：

- 编号式 `.cmd` 启动入口；
- 首次环境检查；
- 交互式课程配置向导；
- 一键 Inspect 只读检查；
- `RUN` 与 `ARM` 双重确认的实战入口；
- 最近结果查看、安全状态恢复、登录资料清除；
- 脱敏诊断包导出；
- 离线 HTML 使用说明；
- 标准 Windows x64 ZIP；
- 自带官方 Node.js 运行时的 Windows x64 便携 ZIP；
- ZIP SHA-256 校验文件。

普通用户应下载名称含 `Windows-x64-portable` 的压缩包。便携包已经包含 Node.js 和 Playwright 生产依赖，但仍需要电脑安装 Chrome 或 Edge。

真实提交保持默认关闭。配置向导写入的日常配置始终为 `submission.enabled=false`；实战启动器创建一次性启用配置，结束后清理。

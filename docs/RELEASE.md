# v1.0.0

首个稳定核心版本提供：

- TypeScript 严格类型检查；
- Chrome/Edge 正常网页登录；
- 教学班数据解析与目标匹配；
- Inspect 只读检查；
- 多课程 Worker 状态机；
- 页面正常选课操作链；
- 独立 Verifier；
- lessonId 互斥与共享页面锁；
- 有界重试和限流等待；
- 登录恢复、异常隔离和运行日志。

真实提交默认关闭，必须同时使用 `--mode run`、本地 `submission.enabled=true` 和 ARM 确认。无法由现有证据可靠判断的业务结果保留为 `UNKNOWN`。

# 系统与程序结构

## 已确认的页面结构

当前版本面向上海财经大学 EAMS 选课页面。已确认的正常页面链包括：

- 入口：`/eams/stdElectCourse!defaultPage.action`
- 教学班数据：`/eams/stdElectCourse!data.action?profileId=...`
- 人数更新：`/eams/stdElectCourse!queryStdCount.action?profileId=...`
- 页面人数映射：`window.lessonId2Counts`
- 页面选退课操作：`/eams/stdElectCourse!batchOperator.action`

页面维护课程数据、已选标记和人数映射。程序复用页面已有数据和正常操作链，不构造独立的裸 HTTP 提交器。

## 运行流程

```text
INIT
  -> LOGIN_REQUIRED
  -> LOADING_DATA
  -> RESOLVING_TARGETS
  -> READY
  -> ARMED
  -> RUNNING
  -> FINISHED
```

用户在 Playwright 打开的 Chrome/Edge 中完成正常登录。程序确认进入目标页面后读取教学班，解析配置，再进行预检查。Inspect 在 READY 后结束；Run 还要求本地安全开关和终端 ARM。

## Worker 与验证

每门目标课程对应一个独立 Worker，状态包括 `PENDING`、`AVAILABLE`、`SUBMITTING`、`VERIFYING`、`SUCCESS`、`FULL`、`RETRY_WAIT`、`CONFLICT`、`NOT_ELIGIBLE`、`UNKNOWN`、`FAILED` 和 `STOPPED`。

每个 lessonId 都有互斥保护。提交结束后必须进入 Verifier；只有已选状态返回 `SELECTED` 才能进入 `SUCCESS`。未知结果先重复读取权威状态，确认未选后才可能按配置等待下一次 Attempt。

不同 Worker 可以独立推进，但学校页面只有一个 Colorbox 操作区，因此页面提交和首轮验证共用一个页面锁。这样可以避免多个课程同时改写同一页面交互状态。

## 人数与开放状态

人数读取复用 `window.lessonId2Counts`，一次快照覆盖全部目标课程。`sc < lc` 只表示名义上有空位，后端资格判断仍是最终依据。开放状态综合页面动作与页面业务状态；页面尚未开放时继续等待，直到开放、达到总运行时限或用户停止。

## Windows 交付层

v1.0.2 的 `delivery/` 为核心执行器提供环境检查、配置向导、Inspect、双重确认的实战入口、结果查看、安全复位、登录资料清除和脱敏诊断导出。Windows 启动器让 Node.js 子进程继承当前控制台句柄，以保留 ARM 确认所需的 TTY。交付层不会修改 `src/` 中的提交、验证、调度或状态机逻辑。

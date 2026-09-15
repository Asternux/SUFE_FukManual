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

## 人数与开放状态

人数读取复用 `window.lessonId2Counts`，一次快照覆盖全部目标课程。`sc < lc` 只表示名义上有空位，后端资格判断仍是最终依据。开放状态综合页面动作、页面业务状态和可选的预期时间，不仅依赖本机时钟。

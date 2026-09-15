param(
  [switch]$NoOpen,
  [switch]$NoPause
)

. (Join-Path $PSScriptRoot "common.ps1")

$deliveryRoot = Get-DeliveryRoot
$logsDirectory = Join-Path $deliveryRoot "logs"
$outputPath = Join-Path $deliveryRoot "最新结果.txt"
$lines = New-Object System.Collections.Generic.List[string]
$stateNames = @{
  "SUCCESS" = "成功（系统最终状态确认已选）"
  "FULL" = "满额并停止"
  "CONFLICT" = "时间或重复课程冲突"
  "NOT_ELIGIBLE" = "没有选课资格"
  "UNKNOWN" = "结果未知，需要人工核对"
  "FAILED" = "失败"
  "STOPPED" = "已停止"
  "PENDING" = "等待中"
  "RETRY_WAIT" = "等待受控重试"
}

if (-not (Test-Path -LiteralPath $logsDirectory)) {
  Write-Host "还没有运行记录。" -ForegroundColor Yellow
  Pause-IfNeeded -NoPause:$NoPause
  exit 0
}

$latestSummary = Get-ChildItem -LiteralPath $logsDirectory -File -Filter "summary-*.json" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
$latestRun = Get-ChildItem -LiteralPath $logsDirectory -File -Filter "run-*.log" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1

$matchingSummary = $null
if ($null -ne $latestRun -and $latestRun.BaseName -match "^run-(.+)$") {
  $candidateSummary = Join-Path $logsDirectory "summary-$($Matches[1]).json"
  if (Test-Path -LiteralPath $candidateSummary) { $matchingSummary = Get-Item -LiteralPath $candidateSummary }
}
if ($null -ne $matchingSummary) { $latestSummary = $matchingSummary }
$useSummary = $null -ne $latestSummary -and ($null -eq $latestRun -or $null -ne $matchingSummary)
$lines.Add("上财选课执行器：最近结果")
$lines.Add("生成时间：$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))")
$lines.Add("")

if ($useSummary) {
  try {
    $summary = Read-JsonFile $latestSummary.FullName
    $generated = [DateTime]::Parse([string]$summary.generatedAt).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss")
    $lines.Add("运行结束时间：$generated")
    $lines.Add("结果来源：$($latestSummary.FullName)")
    $lines.Add("")
    foreach ($course in @($summary.courses)) {
      $state = [string]$course.state
      $friendly = if ($stateNames.ContainsKey($state)) { $stateNames[$state] } else { $state }
      $attempts = @($course.attempts).Count
      $lines.Add("课程：$($course.name)")
      $lines.Add("  lessonId：$($course.lessonId)")
      $lines.Add("  最终结果：$friendly")
      $lines.Add("  实际提交尝试：$attempts 次")
      if ($attempts -gt 0) {
        $lastAttempt = @($course.attempts)[-1]
        if ($null -ne $lastAttempt.endReason) { $lines.Add("  最后原因：$($lastAttempt.endReason)") }
      }
      $lines.Add("")
    }
  } catch {
    $lines.Add("总结文件无法读取：$($_.Exception.Message)")
  }
} elseif ($null -ne $latestRun) {
  $lines.Add("最近一次是只读检查或未生成最终总结的运行。")
  $lines.Add("日志来源：$($latestRun.FullName)")
  $lines.Add("")
  $courseInfo = [ordered]@{}
  foreach ($line in Get-Content -LiteralPath $latestRun.FullName -Encoding UTF8) {
    if ($line -notmatch "^\[[^\]]+\] \[[^\]]+\] \[([^\]]+)\] (.*)$") { continue }
    $scope = $Matches[1]
    $message = $Matches[2]
    if ($scope -eq "RUN" -or $scope -eq "SUMMARY" -or $scope -eq "SCHEDULER" -or $scope -eq "CLI") { continue }
    if (-not $courseInfo.Contains($scope)) {
      $courseInfo[$scope] = [ordered]@{ lessonId = ""; count = ""; selected = ""; open = ""; action = ""; block = "" }
    }
    $item = $courseInfo[$scope]
    if ($message -match "resolved lessonId=([^ ]+)") { $item.lessonId = $Matches[1] }
    if ($message -match "count=([^ ]+)") { $item.count = $Matches[1] }
    if ($message -match "preflight selected=(true|false) electionOpen=(true|false) pageActionAvailable=(true|false)") {
      $item.selected = $Matches[1]
      $item.open = $Matches[2]
      $item.action = $Matches[3]
    }
    if ($message -match "preflightBlock=([^ ]+) (.*)$") { $item.block = "$($Matches[1]) $($Matches[2])" }
  }

  foreach ($name in $courseInfo.Keys) {
    $item = $courseInfo[$name]
    $status = if ($item.selected -eq "true") {
      "已选，不会再次提交"
    } elseif (-not [string]::IsNullOrWhiteSpace($item.block)) {
      "预检查阻止：$($item.block)"
    } elseif ($item.open -eq "false") {
      "页面尚未开放"
    } elseif ($item.action -eq "true") {
      "页面操作入口可用；最终资格仍以后端为准"
    } else {
      "页面操作入口暂不可用"
    }
    $lines.Add("课程：$name")
    $lines.Add("  lessonId：$($item.lessonId)")
    if (-not [string]::IsNullOrWhiteSpace($item.count)) { $lines.Add("  人数：$($item.count)") }
    $lines.Add("  检查结论：$status")
    $lines.Add("")
  }
} else {
  $lines.Add("还没有可读取的运行日志。")
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($outputPath, $lines, $utf8)
Write-Host ($lines -join "`n")
Write-Host "结果文件：$outputPath" -ForegroundColor Cyan
if (-not $NoOpen) {
  Start-Process notepad.exe -ArgumentList @($outputPath)
}
Pause-IfNeeded -NoPause:$NoPause

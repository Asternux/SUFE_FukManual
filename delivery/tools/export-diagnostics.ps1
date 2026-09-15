param([switch]$NoPause)

. (Join-Path $PSScriptRoot "common.ps1")

$deliveryRoot = Get-DeliveryRoot
$logs = Join-Path $deliveryRoot "logs"
$diagnostics = Join-Path $deliveryRoot "diagnostics"
if (-not (Test-Path -LiteralPath $logs)) {
  Write-Host "还没有日志，暂时无法导出诊断包。" -ForegroundColor Yellow
  Pause-IfNeeded -NoPause:$NoPause
  exit 0
}
if (-not (Test-Path -LiteralPath $diagnostics)) {
  New-Item -ItemType Directory -Path $diagnostics -Force | Out-Null
}

$stamp = [DateTime]::Now.ToString("yyyyMMdd-HHmmss")
$staging = Join-Path $diagnostics "staging-$stamp-$PID"
$zipPath = Join-Path $diagnostics "diagnostics-$stamp.zip"
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
  $latestRun = Get-ChildItem -LiteralPath $logs -File -Filter "run-*.log" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $latestSummary = Get-ChildItem -LiteralPath $logs -File -Filter "summary-*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if ($null -ne $latestRun) { Copy-Item -LiteralPath $latestRun.FullName -Destination $staging }
  if ($null -ne $latestSummary) { Copy-Item -LiteralPath $latestSummary.FullName -Destination $staging }
  $report = Join-Path $deliveryRoot "检查报告.txt"
  if (Test-Path -LiteralPath $report) { Copy-Item -LiteralPath $report -Destination $staging }

  $notice = @"
此诊断包只包含程序生成的脱敏日志、最终总结和环境检查报告。
它不包含 courses.json、.runtime、Cookie、Session、密码、验证码或浏览器资料。
课程名称、lessonId、运行时间和状态仍会出现在日志中；分享前请自行确认。
"@
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText((Join-Path $staging "分享前请阅读.txt"), $notice, $utf8)
  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
  Write-Host "诊断包已生成：$zipPath" -ForegroundColor Green
  Write-Host "诊断包不包含课程配置和登录资料；课程名称与 lessonId 仍可能出现。" -ForegroundColor Yellow
} catch {
  Write-Host "导出失败：$($_.Exception.Message)" -ForegroundColor Red
  Pause-IfNeeded -NoPause:$NoPause
  exit 1
} finally {
  $resolvedStaging = [System.IO.Path]::GetFullPath($staging)
  $resolvedDiagnostics = [System.IO.Path]::GetFullPath($diagnostics) + [System.IO.Path]::DirectorySeparatorChar
  if ($resolvedStaging.StartsWith($resolvedDiagnostics, [System.StringComparison]::OrdinalIgnoreCase) -and
      (Test-Path -LiteralPath $resolvedStaging)) {
    Remove-Item -LiteralPath $resolvedStaging -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Pause-IfNeeded -NoPause:$NoPause

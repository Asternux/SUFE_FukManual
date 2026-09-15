param(
  [switch]$DryRun,
  [switch]$NoPause
)

. (Join-Path $PSScriptRoot "common.ps1")

$exitCode = 1
$temporaryConfig = $null
$baseConfigPath = Get-BaseConfigPath
try {
  $config = Assert-ConfigReady $baseConfigPath
  if ($config.submission.enabled -eq $true) {
    Set-SubmissionEnabled $baseConfigPath $false
    $config = Assert-ConfigReady $baseConfigPath
  }

  Write-Host "========================================" -ForegroundColor Yellow
  Write-Host " 实战运行：下列课程可能产生真实选课操作" -ForegroundColor Yellow
  Write-Host "========================================" -ForegroundColor Yellow
  Show-CourseSummary $config
  Write-Host "每门最多尝试：$($config.retry.maxAttempts) 次"
  Write-Host "最短重试间隔：$([int]$config.retry.minDelayMs / 1000) 秒"
  Write-Host "最长运行时间：$([Math]::Round([double]$config.scheduler.maxRunDurationMs / 3600000, 1)) 小时"
  Write-Host ""

  $confirmed = $true
  if (-not $DryRun) {
    $answer = Read-Host "确认课程清单无误后输入 RUN；输入其他内容将取消"
    if ($answer.Trim() -ne "RUN") {
      Write-Host "已取消，没有启动浏览器，也没有提交。" -ForegroundColor Yellow
      $exitCode = 0
      $confirmed = $false
    }
  }

  if ($confirmed) {
    $runtimeDirectory = Join-Path (Get-DeliveryRoot) ".runtime"
    if (-not (Test-Path -LiteralPath $runtimeDirectory)) {
      New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    }
    $temporaryConfig = Join-Path $runtimeDirectory "courses.run.$PID.json"
    $runConfig = Read-JsonFile $baseConfigPath
    $runConfig.submission.enabled = $true
    $runConfig.submission.requireArmPhrase = $true
    Write-JsonFileAtomic $temporaryConfig $runConfig

    Write-Host ""
    Write-Host "浏览器登录并完成预检查后，终端还会要求输入 ARM。" -ForegroundColor Yellow
    Write-Host "只有输入 ARM 后才允许执行页面选课。"
    $exitCode = Invoke-Executor -Mode "run" -ConfigPath $temporaryConfig -DryRun:$DryRun
    if ($exitCode -eq 0) {
      Write-Host "运行已经结束，可查看最近结果。" -ForegroundColor Green
    } else {
      Write-Host "运行异常结束，退出码：$exitCode。请查看日志或导出诊断包。" -ForegroundColor Red
    }
  }
} catch {
  $exitCode = 1
  Write-Host "无法开始实战运行：$($_.Exception.Message)" -ForegroundColor Red
} finally {
  if ($null -ne $temporaryConfig -and (Test-Path -LiteralPath $temporaryConfig)) {
    Remove-Item -LiteralPath $temporaryConfig -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $baseConfigPath) {
    try { Set-SubmissionEnabled $baseConfigPath $false } catch {}
  }
  Write-Host "日常配置的提交开关已保持为关闭。" -ForegroundColor Cyan
}

Pause-IfNeeded -NoPause:$NoPause
exit $exitCode

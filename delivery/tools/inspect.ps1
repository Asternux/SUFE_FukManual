param(
  [switch]$DryRun,
  [switch]$NoPause
)

. (Join-Path $PSScriptRoot "common.ps1")

try {
  $configPath = Get-BaseConfigPath
  $config = Assert-ConfigReady $configPath
  if ($config.submission.enabled -eq $true) {
    Set-SubmissionEnabled $configPath $false
    $config = Assert-ConfigReady $configPath
    Write-Host "已自动把日常配置的提交开关恢复为关闭。" -ForegroundColor Yellow
  }
  Write-Host "========================================" -ForegroundColor Cyan
  Write-Host " 只读检查：不会提交、不会选课、不会退课" -ForegroundColor Cyan
  Write-Host "========================================" -ForegroundColor Cyan
  Show-CourseSummary $config
  $exitCode = Invoke-Executor -Mode "inspect" -ConfigPath $configPath -DryRun:$DryRun
  if ($exitCode -eq 0) {
    Write-Host "只读检查已完成。" -ForegroundColor Green
    if (-not $DryRun) { Write-Host "可双击「5_查看最近结果.cmd」查看整理后的记录。" }
  } else {
    Write-Host "只读检查未正常完成，退出码：$exitCode" -ForegroundColor Red
  }
} catch {
  $exitCode = 1
  Write-Host "无法开始只读检查：$($_.Exception.Message)" -ForegroundColor Red
}

Pause-IfNeeded -NoPause:$NoPause
exit $exitCode

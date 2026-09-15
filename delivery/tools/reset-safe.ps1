param([switch]$NoPause)

. (Join-Path $PSScriptRoot "common.ps1")

try {
  $configPath = Get-BaseConfigPath
  if (Test-Path -LiteralPath $configPath) {
    Set-SubmissionEnabled $configPath $false
    Write-Host "日常配置的 submission.enabled 已设为 false。" -ForegroundColor Green
  } else {
    Write-Host "尚未生成课程配置，无需复位。" -ForegroundColor Yellow
  }

  $runtime = Join-Path (Get-DeliveryRoot) ".runtime"
  if (Test-Path -LiteralPath $runtime) {
    Get-ChildItem -LiteralPath $runtime -File -Filter "courses.run.*.json" -ErrorAction SilentlyContinue |
      ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }
  }
  Write-Host "遗留的临时运行配置已清理。" -ForegroundColor Green
  Write-Host "提示：如果实战窗口仍在运行，请在那个窗口输入 stop；修改文件不会停止已经启动的任务。" -ForegroundColor Yellow
} catch {
  Write-Host "安全复位失败：$($_.Exception.Message)" -ForegroundColor Red
  Pause-IfNeeded -NoPause:$NoPause
  exit 1
}

Pause-IfNeeded -NoPause:$NoPause
exit 0

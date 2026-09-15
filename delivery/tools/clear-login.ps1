param([switch]$NoPause)

. (Join-Path $PSScriptRoot "common.ps1")

$deliveryRoot = Get-DeliveryRoot
$profilePath = [System.IO.Path]::GetFullPath((Join-Path $deliveryRoot ".runtime\browser-profile"))
$expectedParent = [System.IO.Path]::GetFullPath((Join-Path $deliveryRoot ".runtime"))

Write-Host "此操作用于换人使用或清除失效登录。" -ForegroundColor Yellow
Write-Host "它会删除本工具保存的浏览器 Cookie 和登录状态，不会退课，也不会删除课程配置和日志。"
Write-Host "请先关闭本工具打开的浏览器和运行窗口。"

if (-not (Test-Path -LiteralPath $profilePath)) {
  Write-Host "当前没有保存的登录状态。" -ForegroundColor Green
  Pause-IfNeeded -NoPause:$NoPause
  exit 0
}

$answer = Read-Host "输入 CLEAR 确认清除；输入其他内容取消"
if ($answer.Trim() -ne "CLEAR") {
  Write-Host "已取消。" -ForegroundColor Yellow
  Pause-IfNeeded -NoPause:$NoPause
  exit 0
}

if ((Split-Path $profilePath -Parent) -ne $expectedParent -or (Split-Path $profilePath -Leaf) -ne "browser-profile") {
  Write-Host "路径安全检查失败，未删除任何内容：$profilePath" -ForegroundColor Red
  Pause-IfNeeded -NoPause:$NoPause
  exit 1
}

try {
  Remove-Item -LiteralPath $profilePath -Recurse -Force
  Write-Host "登录状态已清除。下次运行时需要重新正常登录。" -ForegroundColor Green
} catch {
  Write-Host "清除失败。请确认浏览器已关闭。`n$($_.Exception.Message)" -ForegroundColor Red
  Pause-IfNeeded -NoPause:$NoPause
  exit 1
}

Pause-IfNeeded -NoPause:$NoPause

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$tools = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\tools"))
. (Join-Path $tools "common.ps1")

$passed = 0
function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "断言失败：$Message" }
  $script:passed += 1
  Write-Host "[PASS] $Message" -ForegroundColor Green
}

Write-Host "运行交付层测试……" -ForegroundColor Cyan

$parseErrors = @()
foreach ($file in Get-ChildItem -LiteralPath $tools -File -Filter "*.ps1") {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
  foreach ($error in @($errors)) { $parseErrors += "$($file.Name): $($error.Message)" }
}
Assert-True ($parseErrors.Count -eq 0) "全部 PowerShell 工具通过语法解析"

$normalized = Normalize-EntryUrl "https://eams.sufe.edu.cn/eams/stdElectCourse!defaultPage.action?ticket=secret&electionProfile.id=12345&token=secret"
Assert-True ($normalized -eq "https://eams.sufe.edu.cn/eams/stdElectCourse!defaultPage.action?electionProfile.id=12345") "入口网址只保留选课轮次 ID"

$rejectedHost = $false
try { Normalize-EntryUrl "https://example.com/eams/stdElectCourse!defaultPage.action?electionProfile.id=12345" | Out-Null } catch { $rejectedHost = $true }
Assert-True $rejectedHost "拒绝非学校域名"

$appRoot = Get-AppRoot
Assert-True (Test-Path -LiteralPath (Join-Path $appRoot "dist\src\main.js")) "可以定位已编译主程序"
Assert-True (Test-Path -LiteralPath (Join-Path $appRoot "node_modules\playwright\package.json")) "可以定位 Playwright"

$deliveryRoot = Get-DeliveryRoot
$cmdFiles = Get-ChildItem -LiteralPath $deliveryRoot -File -Filter "*.cmd"
Assert-True ($cmdFiles.Count -ge 9) "小白入口脚本齐全"
foreach ($cmd in $cmdFiles) {
  $content = Get-Content -LiteralPath $cmd.FullName -Raw
  if ($content -match 'tools\\([^"\r\n]+\.ps1)') {
    Assert-True (Test-Path -LiteralPath (Join-Path $tools $Matches[1])) "$($cmd.Name) 指向存在的工具脚本"
  }
}

$configPath = Get-BaseConfigPath
$backupBytes = $null
$hadConfig = Test-Path -LiteralPath $configPath
if ($hadConfig) { $backupBytes = [System.IO.File]::ReadAllBytes($configPath) }
$testConfig = [PSCustomObject][ordered]@{
  entryUrl = "https://eams.sufe.edu.cn/eams/stdElectCourse!defaultPage.action?electionProfile.id=12345"
  browser = [PSCustomObject][ordered]@{ channel = "chrome"; headless = $false; loginTimeoutMs = 600000 }
  submission = [PSCustomObject][ordered]@{ enabled = $false; requireArmPhrase = $true; minGlobalIntervalMs = 1500 }
  retry = [PSCustomObject][ordered]@{ maxAttempts = 1; minDelayMs = 15000; unknownVerificationDelayMs = 3000; maxUnknownVerifications = 3 }
  scheduler = [PSCustomObject][ordered]@{ tickIntervalMs = 1000; maxRunDurationMs = 3600000 }
  courses = @([PSCustomObject][ordered]@{ name = "交付测试课程"; lessonId = "999999"; priority = 1 })
}

try {
  Write-JsonFileAtomic $configPath $testConfig
  $loaded = Assert-ConfigReady $configPath
  Assert-True (@($loaded.courses).Count -eq 1) "测试配置可以读取"

  Set-SubmissionEnabled $configPath $true
  Assert-True ((Read-JsonFile $configPath).submission.enabled -eq $true) "可以临时打开提交字段"
  Set-SubmissionEnabled $configPath $false
  Assert-True ((Read-JsonFile $configPath).submission.enabled -eq $false) "可以恢复安全状态"

  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tools "inspect.ps1") -DryRun -NoPause
  Assert-True ($LASTEXITCODE -eq 0) "只读启动器 DryRun 通过"

  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tools "run.ps1") -DryRun -NoPause
  Assert-True ($LASTEXITCODE -eq 0) "实战启动器 DryRun 通过"
  Assert-True ((Read-JsonFile $configPath).submission.enabled -eq $false) "实战启动器结束后保持日常开关闭合"
  $leftover = Get-ChildItem -LiteralPath (Join-Path $deliveryRoot ".runtime") -File -Filter "courses.run.*.json" -ErrorAction SilentlyContinue
  Assert-True (@($leftover).Count -eq 0) "实战临时配置已经清理"
} finally {
  if ($hadConfig) {
    [System.IO.File]::WriteAllBytes($configPath, $backupBytes)
  } elseif (Test-Path -LiteralPath $configPath) {
    Remove-Item -LiteralPath $configPath -Force
  }
}

$logsDirectory = Join-Path $deliveryRoot "logs"
$diagnosticsDirectory = Join-Path $deliveryRoot "diagnostics"
$syntheticRunId = "delivery-test-$PID"
$syntheticSummary = Join-Path $logsDirectory "summary-$syntheticRunId.json"
$syntheticRun = Join-Path $logsDirectory "run-$syntheticRunId.log"
$resultOutput = Join-Path $deliveryRoot "最新结果.txt"
try {
  if (-not (Test-Path -LiteralPath $logsDirectory)) { New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null }
  $summaryData = [PSCustomObject][ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString("o")
    courses = @([PSCustomObject][ordered]@{ name = "结果测试课程"; lessonId = "999999"; state = "SUCCESS"; attempts = @() })
  }
  Write-JsonFileAtomic $syntheticSummary $summaryData
  [System.IO.File]::WriteAllText($syntheticRun, "[2026-01-01T00:00:00.000Z] [INFO] [SUMMARY] complete`r`n", (New-Object System.Text.UTF8Encoding($false)))
  (Get-Item -LiteralPath $syntheticSummary).LastWriteTime = [DateTime]::Now.AddMinutes(4)
  (Get-Item -LiteralPath $syntheticRun).LastWriteTime = [DateTime]::Now.AddMinutes(5)

  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tools "latest-result.ps1") -NoOpen -NoPause
  Assert-True ($LASTEXITCODE -eq 0) "最近结果整理脚本通过"
  $friendlyResult = Get-Content -LiteralPath $resultOutput -Raw -Encoding UTF8
  Assert-True ($friendlyResult.Contains("系统最终状态确认已选")) "最终状态可以转换为中文说明"

  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $tools "export-diagnostics.ps1") -NoPause
  Assert-True ($LASTEXITCODE -eq 0) "诊断包导出脚本通过"
  $diagnosticZip = Get-ChildItem -LiteralPath $diagnosticsDirectory -File -Filter "diagnostics-*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  Assert-True ($null -ne $diagnosticZip) "诊断 ZIP 已生成"
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($diagnosticZip.FullName)
  try {
    $unsafeEntry = $zip.Entries | Where-Object { $_.FullName -match "courses\.json|browser-profile|\.runtime" }
    Assert-True (@($unsafeEntry).Count -eq 0) "诊断包排除了配置和浏览器资料"
  } finally {
    $zip.Dispose()
  }
} finally {
  if (Test-Path -LiteralPath $syntheticSummary) { Remove-Item -LiteralPath $syntheticSummary -Force }
  if (Test-Path -LiteralPath $syntheticRun) { Remove-Item -LiteralPath $syntheticRun -Force }
  if (Test-Path -LiteralPath $resultOutput) { Remove-Item -LiteralPath $resultOutput -Force }
  if (Test-Path -LiteralPath $diagnosticsDirectory) {
    $resolvedDiagnostics = [System.IO.Path]::GetFullPath($diagnosticsDirectory)
    $expectedDiagnostics = [System.IO.Path]::GetFullPath((Join-Path $deliveryRoot "diagnostics"))
    if ($resolvedDiagnostics -eq $expectedDiagnostics) { Remove-Item -LiteralPath $diagnosticsDirectory -Recurse -Force }
  }
  if ((Test-Path -LiteralPath $logsDirectory) -and @((Get-ChildItem -LiteralPath $logsDirectory -Force)).Count -eq 0) {
    Remove-Item -LiteralPath $logsDirectory -Force
  }
}

Write-Host "交付层测试完成：$passed 项通过。" -ForegroundColor Green

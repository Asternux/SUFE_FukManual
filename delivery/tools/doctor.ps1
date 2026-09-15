param(
  [string]$ConfigPath,
  [switch]$NoPause
)

. (Join-Path $PSScriptRoot "common.ps1")

$deliveryRoot = Get-DeliveryRoot
if ([string]::IsNullOrWhiteSpace($ConfigPath)) { $ConfigPath = Get-BaseConfigPath }
$reportPath = Join-Path $deliveryRoot "检查报告.txt"
$report = New-Object System.Collections.Generic.List[string]
$hasFailure = $false

function Add-Check([string]$Level, [string]$Message) {
  $color = switch ($Level) {
    "通过" { "Green" }
    "提醒" { "Yellow" }
    default { "Red" }
  }
  $line = "[$Level] $Message"
  Write-Host $line -ForegroundColor $color
  $script:report.Add($line)
  if ($Level -eq "失败") { $script:hasFailure = $true }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 上财选课执行器：首次环境检查" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

if ($env:OS -eq "Windows_NT") {
  Add-Check "通过" "Windows 系统"
} else {
  Add-Check "失败" "当前交付包只支持 Windows 10/11"
}

$node = Get-NodeExecutable
if ($null -eq $node) {
  Add-Check "失败" "没有找到 Node.js 20 或更高版本；请安装 Node.js LTS，或使用自带 Node 的便携包"
} else {
  try {
    $nodeVersion = (& $node --version 2>$null).Trim()
    $major = if ($nodeVersion -match "^v([0-9]+)") { [int]$Matches[1] } else { 0 }
    if ($major -ge 20) {
      Add-Check "通过" "Node.js $nodeVersion（$node）"
    } else {
      Add-Check "失败" "Node.js 版本过低：$nodeVersion；需要 20 或更高版本"
    }
  } catch {
    Add-Check "失败" "Node.js 无法正常启动：$($_.Exception.Message)"
  }
}

$appRoot = Get-AppRoot
$mainScript = Join-Path $appRoot "dist\src\main.js"
if (Test-Path -LiteralPath $mainScript) {
  Add-Check "通过" "主程序完整"
} else {
  Add-Check "失败" "主程序缺失：$mainScript"
}

$playwrightPackage = Join-Path $appRoot "node_modules\playwright\package.json"
if (Test-Path -LiteralPath $playwrightPackage) {
  Add-Check "通过" "Playwright 运行依赖完整"
} else {
  Add-Check "失败" "Playwright 依赖缺失；当前文件夹可能没有完整解压"
}

$selectedChannel = $null
if (Test-Path -LiteralPath $ConfigPath) {
  try {
    $config = Assert-ConfigReady $ConfigPath
    $selectedChannel = [string]$config.browser.channel
    Add-Check "通过" "配置文件格式正确，共 $(@($config.courses).Count) 门目标课程"
    if ($config.submission.enabled -eq $true) {
      Add-Check "提醒" "配置中的提交开关为 true；建议运行「6_恢复安全状态」"
    } else {
      Add-Check "通过" "日常配置的提交开关处于关闭状态"
    }

    $seen = @{}
    foreach ($course in @($config.courses)) {
      $lessonId = [string](Get-PropertyValue $course "lessonId" "")
      if (-not [string]::IsNullOrWhiteSpace($lessonId)) {
        if ($seen.ContainsKey($lessonId)) {
          Add-Check "失败" "lessonId=$lessonId 在课程列表中重复"
        }
        $seen[$lessonId] = $true
      }
    }
  } catch {
    Add-Check "失败" $_.Exception.Message
  }
} else {
  Add-Check "提醒" "尚未生成课程配置；请运行「2_填写课程」"
}

if ([string]::IsNullOrWhiteSpace($selectedChannel)) {
  $chrome = Find-BrowserExecutable "chrome"
  $edge = Find-BrowserExecutable "msedge"
  if ($null -ne $chrome -or $null -ne $edge) {
    $names = @()
    if ($null -ne $chrome) { $names += "Chrome" }
    if ($null -ne $edge) { $names += "Edge" }
    Add-Check "通过" "检测到浏览器：$($names -join '、')"
  } else {
    Add-Check "失败" "没有检测到 Chrome 或 Edge"
  }
} else {
  $browser = Find-BrowserExecutable $selectedChannel
  $browserName = if ($selectedChannel -eq "msedge") { "Edge" } else { "Chrome" }
  if ($null -ne $browser) {
    Add-Check "通过" "配置指定的 $browserName 已安装"
  } else {
    Add-Check "失败" "配置指定了 $browserName，但没有在常用安装位置找到它"
  }
}

$report.Insert(0, "检查时间：$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss'))")
$report.Add("")
$report.Add($(if ($hasFailure) { "结论：存在必须解决的问题。" } else { "结论：基础环境可以使用。" }))
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($reportPath, $report, $utf8)

Write-Host ""
if ($hasFailure) {
  Write-Host "结论：存在必须解决的问题。" -ForegroundColor Red
} else {
  Write-Host "结论：基础环境可以使用。" -ForegroundColor Green
}
Write-Host "检查报告：$reportPath"
Pause-IfNeeded -NoPause:$NoPause
if ($hasFailure) { exit 1 }
exit 0

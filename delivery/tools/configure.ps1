param([switch]$NoPause)

. (Join-Path $PSScriptRoot "common.ps1")

$configPath = Get-BaseConfigPath
$existing = $null
if (Test-Path -LiteralPath $configPath) {
  try {
    $existing = Read-JsonFile $configPath
  } catch {
    Write-Host "旧配置无法读取，将重新填写。原因：$($_.Exception.Message)" -ForegroundColor Yellow
  }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " 上财选课执行器：课程配置向导" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "这里不填写账号、密码、验证码、Cookie 或 Token。"
Write-Host "入口网址中的 ticket、code、token 等参数会被自动删除。"
Write-Host ""

$defaultUrl = if ($null -ne $existing) { [string]$existing.entryUrl } else { "" }
while ($true) {
  $rawUrl = Read-RequiredValue "粘贴当前选课主页网址" $defaultUrl
  try {
    $entryUrl = Normalize-EntryUrl $rawUrl
    break
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Yellow
  }
}

$existingBrowser = if ($null -ne $existing) { Get-PropertyValue $existing "browser" $null } else { $null }
$existingChannel = [string](Get-PropertyValue $existingBrowser "channel" "chrome")
$defaultChannel = if ($existingChannel -eq "msedge") { "2" } else { "1" }
while ($true) {
  $browserChoice = Read-Value "使用浏览器：1=Chrome，2=Edge" $defaultChannel
  if ($browserChoice -eq "1") { $browserChannel = "chrome"; break }
  if ($browserChoice -eq "2") { $browserChannel = "msedge"; break }
  Write-Host "请输入 1 或 2。" -ForegroundColor Yellow
}

$defaultAttempts = 1
$existingRetry = if ($null -ne $existing) { Get-PropertyValue $existing "retry" $null } else { $null }
$existingMaxAttempts = Get-PropertyValue $existingRetry "maxAttempts" $null
if ($null -ne $existingMaxAttempts) {
  $defaultAttempts = [int]$existingMaxAttempts
}
$maxAttempts = Read-Integer "每门课程最多尝试次数（首次使用建议 1）" $defaultAttempts 1 10

$defaultHours = 6
$existingScheduler = if ($null -ne $existing) { Get-PropertyValue $existing "scheduler" $null } else { $null }
$existingMaxDuration = Get-PropertyValue $existingScheduler "maxRunDurationMs" $null
if ($null -ne $existingMaxDuration) {
  $defaultHours = [Math]::Max(1, [Math]::Min(24, [int]([double]$existingMaxDuration / 3600000)))
}
$maxHours = Read-Integer "最长等待小时数" $defaultHours 1 24

$courses = @()
if ($null -ne $existing -and @($existing.courses).Count -gt 0) {
  Show-CourseSummary $existing
  $keepCourses = Read-YesNo "保留上面现有的课程列表" $true
  if ($keepCourses) { $courses = @($existing.courses) }
}

if ($courses.Count -eq 0) {
  $continueAdding = $true
  $courseIndex = 1
  while ($continueAdding) {
    Write-Host ""
    Write-Host "填写第 $courseIndex 门课程" -ForegroundColor Cyan
    $name = Read-RequiredValue "课程名称" ""
    $lessonId = Read-Value "lessonId（最准确，已知时优先填写）" ""
    $lessonNo = ""
    $courseCode = ""
    $teacher = ""
    $time = ""
    if ([string]::IsNullOrWhiteSpace($lessonId)) {
      $lessonNo = Read-Value "课程序号/教学班号（如 0001；未知可留空）" ""
      if ([string]::IsNullOrWhiteSpace($lessonNo)) {
        $courseCode = Read-Value "课程代码（未知可留空）" ""
        $teacher = Read-Value "教师（没有 lessonId/教学班号时建议填写）" ""
        $time = Read-Value "上课时间和地点（用于消除同名歧义，可留空）" ""
      }
    }
    if ([string]::IsNullOrWhiteSpace($lessonId) -and
        [string]::IsNullOrWhiteSpace($lessonNo) -and
        [string]::IsNullOrWhiteSpace($courseCode) -and
        [string]::IsNullOrWhiteSpace($teacher) -and
        [string]::IsNullOrWhiteSpace($time)) {
      Write-Host "仅有课程名称无法可靠匹配，请至少补充 lessonId、教学班号、课程代码、教师或时间。" -ForegroundColor Yellow
      continue
    }
    $priority = Read-Integer "priority（数字越小越优先；不冲突时可全部填 1）" $courseIndex 0 999
    $course = [ordered]@{ name = $name }
    if (-not [string]::IsNullOrWhiteSpace($lessonId)) { $course.lessonId = $lessonId }
    if (-not [string]::IsNullOrWhiteSpace($lessonNo)) { $course.lessonNo = $lessonNo }
    if (-not [string]::IsNullOrWhiteSpace($courseCode)) { $course.courseCode = $courseCode }
    if (-not [string]::IsNullOrWhiteSpace($teacher)) { $course.teacher = $teacher }
    if (-not [string]::IsNullOrWhiteSpace($time)) { $course.time = $time }
    $course.priority = $priority
    $courses += [PSCustomObject]$course
    $courseIndex += 1
    $continueAdding = Read-YesNo "继续添加下一门课程" $false
  }
}

$config = [PSCustomObject][ordered]@{
  entryUrl = $entryUrl
  browser = [PSCustomObject][ordered]@{
    channel = $browserChannel
    headless = $false
    loginTimeoutMs = 600000
  }
  submission = [PSCustomObject][ordered]@{
    enabled = $false
    requireArmPhrase = $true
    minGlobalIntervalMs = 1500
  }
  retry = [PSCustomObject][ordered]@{
    maxAttempts = $maxAttempts
    minDelayMs = 15000
    unknownVerificationDelayMs = 3000
    maxUnknownVerifications = 3
  }
  scheduler = [PSCustomObject][ordered]@{
    tickIntervalMs = 1000
    maxRunDurationMs = $maxHours * 3600000
  }
  courses = $courses
}

if (Test-Path -LiteralPath $configPath) {
  $timestamp = [DateTime]::Now.ToString("yyyyMMdd-HHmmss")
  Copy-Item -LiteralPath $configPath -Destination "$configPath.backup-$timestamp" -Force
}
Write-JsonFileAtomic $configPath $config

Write-Host ""
Write-Host "配置已保存，提交开关保持关闭。" -ForegroundColor Green
Write-Host "配置文件：$configPath"
Show-CourseSummary $config
Write-Host "下一步请双击「3_只读检查.cmd」。" -ForegroundColor Cyan
Pause-IfNeeded -NoPause:$NoPause

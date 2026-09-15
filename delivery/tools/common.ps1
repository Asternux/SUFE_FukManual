Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Initialize-Console {
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [Console]::InputEncoding = $utf8
  [Console]::OutputEncoding = $utf8
  $script:OutputEncoding = $utf8
}

function Get-DeliveryRoot {
  return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
}

function Get-AppRoot {
  $deliveryRoot = Get-DeliveryRoot
  $packaged = Join-Path $deliveryRoot "app"
  if (Test-Path -LiteralPath (Join-Path $packaged "dist\src\main.js")) {
    return $packaged
  }

  $repository = [System.IO.Path]::GetFullPath((Join-Path $deliveryRoot ".."))
  if (Test-Path -LiteralPath (Join-Path $repository "dist\src\main.js")) {
    return $repository
  }
  return $packaged
}

function Get-NodeExecutable {
  $bundled = Join-Path (Get-DeliveryRoot) "runtime\node.exe"
  if (Test-Path -LiteralPath $bundled) {
    return $bundled
  }
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }
  return $null
}

function Get-BaseConfigPath {
  return Join-Path (Get-DeliveryRoot) "config\courses.json"
}

function Get-PropertyValue([object]$Object, [string]$Name, $DefaultValue = $null) {
  if ($null -eq $Object) { return $DefaultValue }
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return $DefaultValue }
  return $property.Value
}

function Read-JsonFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "文件不存在：$Path"
  }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    throw "JSON 文件格式错误：$Path`n$($_.Exception.Message)"
  }
}

function Write-JsonFileAtomic([string]$Path, [object]$Value) {
  $parent = Split-Path $Path -Parent
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  $temporary = "$Path.tmp.$PID"
  $json = $Value | ConvertTo-Json -Depth 20
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($temporary, "$json`r`n", $utf8)
  Move-Item -LiteralPath $temporary -Destination $Path -Force
}

function Normalize-EntryUrl([string]$RawUrl) {
  try {
    $uri = New-Object System.Uri($RawUrl)
  } catch {
    throw "入口网址不是有效网址。"
  }
  if ($uri.Scheme -ne "https" -or $uri.Host -ne "eams.sufe.edu.cn") {
    throw "入口网址必须使用 https://eams.sufe.edu.cn。"
  }
  if (-not $uri.AbsolutePath.EndsWith("/stdElectCourse!defaultPage.action")) {
    throw "请填写选课主页地址，路径应以 stdElectCourse!defaultPage.action 结尾。"
  }

  $profileId = $null
  foreach ($part in $uri.Query.TrimStart("?").Split("&")) {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    $pieces = $part.Split("=", 2)
    $key = [System.Uri]::UnescapeDataString($pieces[0])
    if ($key -eq "electionProfile.id" -and $pieces.Count -eq 2) {
      $profileId = [System.Uri]::UnescapeDataString($pieces[1])
    }
  }
  if ([string]::IsNullOrWhiteSpace($profileId) -or $profileId -eq "REPLACE_ME") {
    throw "入口网址缺少真实的 electionProfile.id。"
  }
  if ($profileId -notmatch "^[0-9]+$") {
    throw "electionProfile.id 应为数字。"
  }
  return "https://eams.sufe.edu.cn/eams/stdElectCourse!defaultPage.action?electionProfile.id=$profileId"
}

function Read-Value([string]$Prompt, [string]$DefaultValue) {
  $suffix = if ([string]::IsNullOrWhiteSpace($DefaultValue)) { "" } else { " [$DefaultValue]" }
  $answer = Read-Host "$Prompt$suffix"
  if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultValue }
  return $answer.Trim()
}

function Read-RequiredValue([string]$Prompt, [string]$DefaultValue) {
  while ($true) {
    $answer = Read-Value $Prompt $DefaultValue
    if (-not [string]::IsNullOrWhiteSpace($answer)) { return $answer }
    Write-Host "此项不能为空。" -ForegroundColor Yellow
  }
}

function Read-YesNo([string]$Prompt, [bool]$DefaultValue) {
  $hint = if ($DefaultValue) { "Y/n" } else { "y/N" }
  while ($true) {
    $answer = (Read-Host "$Prompt [$hint]").Trim().ToLowerInvariant()
    if ($answer -eq "") { return $DefaultValue }
    if ($answer -eq "y" -or $answer -eq "yes" -or $answer -eq "是") { return $true }
    if ($answer -eq "n" -or $answer -eq "no" -or $answer -eq "否") { return $false }
    Write-Host "请输入 Y 或 N。" -ForegroundColor Yellow
  }
}

function Read-Integer([string]$Prompt, [int]$DefaultValue, [int]$Minimum, [int]$Maximum) {
  while ($true) {
    $raw = Read-Value $Prompt ([string]$DefaultValue)
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -ge $Minimum -and $parsed -le $Maximum) {
      return $parsed
    }
    Write-Host "请输入 $Minimum 到 $Maximum 之间的整数。" -ForegroundColor Yellow
  }
}

function Set-SubmissionEnabled([string]$ConfigPath, [bool]$Enabled) {
  $config = Read-JsonFile $ConfigPath
  if ($null -eq $config.submission) {
    throw "配置缺少 submission 部分。"
  }
  $config.submission.enabled = $Enabled
  Write-JsonFileAtomic $ConfigPath $config
}

function Show-CourseSummary([object]$Config) {
  Write-Host ""
  Write-Host "本次目标课程：" -ForegroundColor Cyan
  $index = 1
  foreach ($course in @($Config.courses)) {
    $lessonId = [string](Get-PropertyValue $course "lessonId" "")
    $lessonNo = [string](Get-PropertyValue $course "lessonNo" "")
    $courseCode = [string](Get-PropertyValue $course "courseCode" "")
    $teacher = [string](Get-PropertyValue $course "teacher" "")
    $time = [string](Get-PropertyValue $course "time" "")
    $priority = Get-PropertyValue $course "priority" 1
    $matcher = if (-not [string]::IsNullOrWhiteSpace($lessonId)) {
      "lessonId=$lessonId"
    } elseif (-not [string]::IsNullOrWhiteSpace($lessonNo)) {
      "教学班号=$lessonNo"
    } elseif (-not [string]::IsNullOrWhiteSpace($courseCode)) {
      "课程代码=$courseCode 教师=$teacher"
    } else {
      "教师=$teacher 时间=$time"
    }
    Write-Host ("  {0}. {1}  [{2}]  priority={3}" -f $index, $course.name, $matcher, $priority)
    $index += 1
  }
  Write-Host ""
}

function Assert-ConfigReady([string]$ConfigPath) {
  $config = Read-JsonFile $ConfigPath
  $config.entryUrl = Normalize-EntryUrl ([string]$config.entryUrl)
  if ($null -eq $config.courses -or @($config.courses).Count -eq 0) {
    throw "课程列表为空。请先运行「2_填写课程」。"
  }
  foreach ($course in @($config.courses)) {
    if ([string]::IsNullOrWhiteSpace([string](Get-PropertyValue $course "name" ""))) {
      throw "存在没有名称的课程。请重新填写配置。"
    }
  }
  return $config
}

function Find-BrowserExecutable([string]$Channel) {
  $programFiles = [Environment]::GetFolderPath("ProgramFiles")
  $programFilesX86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")
  $localAppData = [Environment]::GetFolderPath("LocalApplicationData")
  if ($Channel -eq "msedge") {
    $relative = "Microsoft\Edge\Application\msedge.exe"
  } else {
    $relative = "Google\Chrome\Application\chrome.exe"
  }
  foreach ($base in @($programFiles, $programFilesX86, $localAppData)) {
    if ([string]::IsNullOrWhiteSpace($base)) { continue }
    $candidate = Join-Path $base $relative
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Invoke-ConsoleProcess([string]$FilePath, [string]$ArgumentLine) {
  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentLine -NoNewWindow -PassThru -Wait
  return [int]$process.ExitCode
}

function Invoke-Executor([ValidateSet("inspect", "run")][string]$Mode, [string]$ConfigPath, [switch]$DryRun) {
  $deliveryRoot = Get-DeliveryRoot
  $appRoot = Get-AppRoot
  $mainScript = Join-Path $appRoot "dist\src\main.js"
  $node = Get-NodeExecutable
  if ($null -eq $node) { throw "没有找到 Node.js。请先运行「1_首次环境检查」。" }
  if (-not (Test-Path -LiteralPath $mainScript)) { throw "程序文件缺失：$mainScript" }

  Write-Host "执行模式：$Mode"
  Write-Host "程序位置：$mainScript"
  Write-Host "配置位置：$ConfigPath"
  if ($DryRun) {
    Write-Host "DRY RUN：命令检查完成，未启动浏览器。" -ForegroundColor Green
    return 0
  }

  Push-Location $deliveryRoot
  try {
    # Calling the native process directly from a function whose output is assigned
    # makes Windows PowerShell capture stdout. Node then sees stdout.isTTY=false and
    # the mandatory ARM confirmation fails immediately after READY. Start-Process
    # keeps all three console handles attached while returning only the exit code.
    $argumentLine = '"{0}" --config "{1}" --mode {2}' -f $mainScript, $ConfigPath, $Mode
    return Invoke-ConsoleProcess -FilePath $node -ArgumentLine $argumentLine
  } finally {
    Pop-Location
  }
}

function Pause-IfNeeded([switch]$NoPause) {
  if (-not $NoPause) {
    Write-Host ""
    Read-Host "按回车键关闭窗口" | Out-Null
  }
}

Initialize-Console

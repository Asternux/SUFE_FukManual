param(
  [string]$Version = "1.0.2",
  [string]$NodeDistributionZip = "",
  [string]$NodeShasumsFile = ""
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "release"))
$portable = -not [string]::IsNullOrWhiteSpace($NodeDistributionZip)
$suffix = if ($portable) { "Windows-x64-portable" } else { "Windows-x64" }
$packageName = "SUFE-Course-Executor-v$Version-$suffix"
$target = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot $packageName))
$zipPath = Join-Path $releaseRoot "$packageName.zip"

function Assert-ReleaseChild([string]$Path) {
  $resolved = [System.IO.Path]::GetFullPath($Path)
  $prefix = $releaseRoot + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "拒绝操作 release 目录以外的路径：$resolved"
  }
}

function Remove-ReleaseItem([string]$Path) {
  Assert-ReleaseChild $Path
  if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Recurse -Force }
}

Push-Location $repoRoot
try {
  Write-Host "[1/9] 同步锁定依赖" -ForegroundColor Cyan
  & pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw "依赖同步失败" }

  Write-Host "[2/9] 构建 TypeScript" -ForegroundColor Cyan
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw "TypeScript 构建失败" }

  Write-Host "[3/9] 运行核心测试" -ForegroundColor Cyan
  & pnpm test
  if ($LASTEXITCODE -ne 0) { throw "核心测试失败" }

  Write-Host "[4/9] 运行交付层测试" -ForegroundColor Cyan
  & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repoRoot "delivery\tests\delivery-tests.ps1")
  if ($LASTEXITCODE -ne 0) { throw "交付层测试失败" }

  Write-Host "[5/9] 准备干净的发布目录" -ForegroundColor Cyan
  if (-not (Test-Path -LiteralPath $releaseRoot)) { New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null }
  Remove-ReleaseItem $target
  if (Test-Path -LiteralPath $zipPath) { Remove-ReleaseItem $zipPath }
  $hashPath = "$zipPath.sha256.txt"
  if (Test-Path -LiteralPath $hashPath) { Remove-ReleaseItem $hashPath }
  New-Item -ItemType Directory -Path $target -Force | Out-Null

  Write-Host "[6/9] 部署生产依赖与交付文件" -ForegroundColor Cyan
  $appTarget = Join-Path $target "app"
  New-Item -ItemType Directory -Path $appTarget -Force | Out-Null
  $sourcePackage = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
  $runtimePackage = [PSCustomObject][ordered]@{
    name = $sourcePackage.name
    version = $sourcePackage.version
    private = $true
    type = "module"
    dependencies = $sourcePackage.dependencies
  }
  $packageJsonText = $runtimePackage | ConvertTo-Json -Depth 10
  [System.IO.File]::WriteAllText((Join-Path $appTarget "package.json"), "$packageJsonText`r`n", (New-Object System.Text.UTF8Encoding($false)))

  # pnpm uses junctions in node_modules. Compress-Archive does not preserve those
  # reliably, so the two production packages are materialized as real folders.
  $virtualStore = Join-Path $repoRoot "node_modules\.pnpm"
  $playwrightSource = Get-ChildItem -LiteralPath $virtualStore -Directory |
    Where-Object { $_.Name -like "playwright@*" -and $_.Name -notlike "playwright-core@*" } |
    ForEach-Object { Join-Path $_.FullName "node_modules\playwright" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
  $playwrightCoreSource = Get-ChildItem -LiteralPath $virtualStore -Directory |
    Where-Object { $_.Name -like "playwright-core@*" } |
    ForEach-Object { Join-Path $_.FullName "node_modules\playwright-core" } |
    Where-Object { Test-Path -LiteralPath $_ } |
    Select-Object -First 1
  if ($null -eq $playwrightSource -or $null -eq $playwrightCoreSource) {
    throw "无法从 pnpm virtual store 定位 Playwright 生产依赖"
  }
  $deployedNodeModules = Join-Path $appTarget "node_modules"
  New-Item -ItemType Directory -Path $deployedNodeModules -Force | Out-Null
  Copy-Item -LiteralPath $playwrightSource -Destination (Join-Path $deployedNodeModules "playwright") -Recurse -Force
  Copy-Item -LiteralPath $playwrightCoreSource -Destination (Join-Path $deployedNodeModules "playwright-core") -Recurse -Force
  # pnpm may materialize package-local command shims with absolute paths to the
  # build checkout. They are not used by the runtime and must not enter releases.
  $packageLocalBin = Join-Path $deployedNodeModules "playwright\node_modules\.bin"
  if (Test-Path -LiteralPath $packageLocalBin) { Remove-ReleaseItem $packageLocalBin }

  New-Item -ItemType Directory -Path (Join-Path $appTarget "dist") -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot "dist\src") -Destination (Join-Path $appTarget "dist\src") -Recurse -Force

  Get-ChildItem -LiteralPath (Join-Path $repoRoot "delivery") -Force | ForEach-Object {
    if ($_.Name -ne "tests" -and $_.Name -ne "维护者说明.md" -and $_.Name -ne ".runtime" -and $_.Name -ne "logs") {
      Copy-Item -LiteralPath $_.FullName -Destination $target -Recurse -Force
    }
  }

  if ($portable) {
    Write-Host "[7/9] 加入官方 Node.js 便携运行时" -ForegroundColor Cyan
    $nodeZip = [System.IO.Path]::GetFullPath($NodeDistributionZip)
    if (-not (Test-Path -LiteralPath $nodeZip)) { throw "Node ZIP 不存在：$nodeZip" }
    if ([string]::IsNullOrWhiteSpace($NodeShasumsFile)) { throw "便携构建必须同时提供 NodeShasumsFile" }
    $shasumsPath = [System.IO.Path]::GetFullPath($NodeShasumsFile)
    if (-not (Test-Path -LiteralPath $shasumsPath)) { throw "Node SHA-256 清单不存在：$shasumsPath" }
    $nodeZipName = [System.IO.Path]::GetFileName($nodeZip)
    $expectedLine = Get-Content -LiteralPath $shasumsPath | Where-Object { $_ -match "^[0-9a-fA-F]{64}\s+\*?$([regex]::Escape($nodeZipName))$" } | Select-Object -First 1
    if ($null -eq $expectedLine) { throw "SHA-256 清单中找不到 $nodeZipName" }
    $expectedHash = ($expectedLine -split "\s+")[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) { throw "Node ZIP 的 SHA-256 与官方清单不一致" }
    Write-Host "Node ZIP SHA-256 已与官方清单核对。" -ForegroundColor Green
    $nodeStaging = Join-Path $target "_node-staging"
    New-Item -ItemType Directory -Path $nodeStaging -Force | Out-Null
    Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeStaging -Force
    $nodeExe = Get-ChildItem -LiteralPath $nodeStaging -Recurse -File -Filter "node.exe" | Select-Object -First 1
    if ($null -eq $nodeExe) { throw "Node ZIP 中没有 node.exe" }
    $nodeHome = Split-Path $nodeExe.FullName -Parent
    $nodeLicense = Get-ChildItem -LiteralPath $nodeHome -File | Where-Object { $_.Name -match "^LICENSE" } | Select-Object -First 1
    if ($null -eq $nodeLicense) { throw "Node ZIP 中没有许可证文件，拒绝制作便携包" }
    $runtime = Join-Path $target "runtime"
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    Copy-Item -LiteralPath $nodeExe.FullName -Destination (Join-Path $runtime "node.exe") -Force
    Copy-Item -LiteralPath $nodeLicense.FullName -Destination (Join-Path $runtime "NODE_LICENSE.txt") -Force
    & (Join-Path $runtime "node.exe") --version | Set-Content -LiteralPath (Join-Path $runtime "NODE_VERSION.txt") -Encoding ASCII
    Assert-ReleaseChild $nodeStaging
    Remove-Item -LiteralPath $nodeStaging -Recurse -Force
  } else {
    Write-Host "[7/9] 标准包使用目标电脑上的 Node.js 20+" -ForegroundColor Cyan
  }

  $commit = (& git rev-parse HEAD).Trim()
  $baseline = (& git rev-list -n 1 v1.0.0).Trim()
  $buildInfo = @(
    "交付层版本：$Version",
    "核心基线标签：v1.0.0",
    "核心基线提交：$baseline",
    "构建来源提交：$commit",
    "构建时间：$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'))",
    "自带 Node.js：$portable",
    "支持系统：Windows 10/11 x64",
    "支持浏览器：Google Chrome / Microsoft Edge"
  )
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllLines((Join-Path $target "版本与完整性.txt"), $buildInfo, $utf8)

  Write-Host "[8/9] 检查隐私边界和包内运行依赖" -ForegroundColor Cyan
  $forbiddenNames = Get-ChildItem -LiteralPath $target -Recurse -Force | Where-Object {
    $_.Name -eq "courses.json" -or $_.Name -eq "browser-profile" -or $_.Name -eq "logs" -or $_.Name -eq "diagnostics"
  }
  if (@($forbiddenNames).Count -gt 0) {
    throw "发布包包含不应分发的运行数据：$($forbiddenNames.FullName -join ', ')"
  }
  $appPackage = Join-Path $appTarget "package.json"
  $nodeForCheck = if ($portable) { Join-Path $target "runtime\node.exe" } else { (Get-Command node).Source }
  $resolvedPlaywright = (& $nodeForCheck -e "const {createRequire}=require('node:module'); const r=createRequire(process.argv[1]); console.log(r.resolve('playwright'));" $appPackage).Trim()
  if ($LASTEXITCODE -ne 0) { throw "发布包中的 Playwright 无法解析" }
  $expectedDependencyRoot = [System.IO.Path]::GetFullPath((Join-Path $appTarget "node_modules")) + [System.IO.Path]::DirectorySeparatorChar
  if (-not [System.IO.Path]::GetFullPath($resolvedPlaywright).StartsWith($expectedDependencyRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Playwright 错误地解析到了发布目录之外：$resolvedPlaywright"
  }
  Write-Host $resolvedPlaywright

  Write-Host "[9/9] 创建 ZIP 和 SHA-256" -ForegroundColor Cyan
  Compress-Archive -Path (Join-Path $target "*") -DestinationPath $zipPath -CompressionLevel Optimal -Force
  $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [System.IO.File]::WriteAllText($hashPath, "$hash  $([System.IO.Path]::GetFileName($zipPath))`r`n", $utf8)

  Write-Host "发布包：$zipPath" -ForegroundColor Green
  Write-Host "校验值：$hashPath" -ForegroundColor Green
} finally {
  Pop-Location
}

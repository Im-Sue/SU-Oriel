[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot "..\..\..")
$pwshCommand = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
$powershellCommand = Get-Command "powershell.exe" -ErrorAction SilentlyContinue

Write-Host "[CCB Console] 正在启动前端开发服务..."
Push-Location $projectRoot
try {
    if ($pwshCommand) {
        Write-Host "[CCB Console] 使用 pwsh.exe 启动前端服务"
        & $pwshCommand.Source -NoProfile -Command "Set-Location '$projectRoot'; pnpm --filter ccb-console-web dev"
    }
    elseif ($powershellCommand) {
        Write-Host "[CCB Console] 未检测到 pwsh.exe，已回退到 powershell.exe"
        & $powershellCommand.Source -NoProfile -Command "Set-Location '$projectRoot'; pnpm --filter ccb-console-web dev"
    }
    else {
        throw "未找到可用的 PowerShell 可执行文件，无法启动前端服务"
    }
}
finally {
    Pop-Location
}

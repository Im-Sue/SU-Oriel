[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scriptRoot "..\..\..")

Write-Host "[CCB Console] 正在构建后端服务..."
Push-Location $projectRoot
try {
    & pnpm --filter ccb-console-server db:prepare
    if ($LASTEXITCODE -ne 0) {
        throw "后端数据库准备失败，退出码：$LASTEXITCODE"
    }

    & pnpm --filter ccb-console-server build
    if ($LASTEXITCODE -ne 0) {
        throw "后端构建失败，退出码：$LASTEXITCODE"
    }

    Write-Host "[CCB Console] 正在启动后端服务：http://127.0.0.1:3030"
    & node .\apps\ccb-console\server\dist\index.js
}
finally {
    Pop-Location
}

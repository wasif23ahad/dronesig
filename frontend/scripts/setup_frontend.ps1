param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

$frontendDir = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $frontendDir ".env.local"
$envExamplePath = Join-Path $frontendDir ".env.local.example"
$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue

if (-not $npmCmd) {
    throw "npm is not available on PATH. Install Node.js 18+ and re-run."
}
if (-not $nodeCmd) {
    throw "node is not available on PATH. Install Node.js 18+ and re-run."
}

$nodeVersionText = & $nodeCmd.Source -p "process.versions.node"
if ($LASTEXITCODE -ne 0 -or -not $nodeVersionText) {
    throw "Unable to determine Node.js version. Reinstall Node.js 18+."
}
$nodeVersion = [version]$nodeVersionText.Trim()
if ($nodeVersion.Major -lt 18) {
    throw "Unsupported Node.js version $nodeVersion. Use Node.js 18+."
}

if (-not $SkipInstall) {
    Write-Host "[frontend] Installing dependencies..."
    Push-Location $frontendDir
    try {
        & $npmCmd.Source install
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install frontend dependencies."
        }
    } finally {
        Pop-Location
    }
} else {
    Write-Host "[frontend] Skipping dependency installation."
}

if (-not (Test-Path $envPath)) {
    if (-not (Test-Path $envExamplePath)) {
        throw ".env.local.example not found at $envExamplePath"
    }

    Copy-Item $envExamplePath $envPath
    Write-Host "[frontend] Created .env.local from .env.local.example"
} else {
    Write-Host "[frontend] .env.local already exists."
}

Write-Host "[frontend] Setup complete."
Write-Host "[frontend] Run UI: npm run dev"

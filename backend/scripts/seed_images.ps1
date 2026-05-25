param(
    [switch]$SkipInstall,
    [string]$VenvName = ".seed_venv",
    [string]$PythonCmd = ""
)

$ErrorActionPreference = "Stop"

$backendDir = Split-Path -Parent $PSScriptRoot
$venvDir = Join-Path $backendDir $VenvName
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$uvCacheDir = Join-Path $backendDir ".uv-cache"

function Test-SupportedVersion {
    param([version]$Version)
    return ($Version -and $Version.Major -eq 3 -and $Version.Minor -ge 11 -and $Version.Minor -lt 13)
}

function Get-VenvVersionFromConfig {
    param([string]$VenvRoot)

    $cfgPath = Join-Path $VenvRoot "pyvenv.cfg"
    if (-not (Test-Path $cfgPath)) {
        return $null
    }

    try {
        $line = Get-Content $cfgPath | Where-Object { $_ -match "^\s*version_info\s*=" } | Select-Object -First 1
        if (-not $line) {
            return $null
        }
        if ($line -match "(\d+)\.(\d+)") {
            return [version]"$($matches[1]).$($matches[2])"
        }
    } catch {
        return $null
    }

    return $null
}

function Resolve-PythonFromInvocation {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [string[]]$PrefixArgs = @()
    )

    try {
        $json = & $Command @PrefixArgs -c "import json, sys; print(json.dumps({'exe': sys.executable, 'ver': f'{sys.version_info.major}.{sys.version_info.minor}'}))" 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $json) {
            return $null
        }

        $info = $json | ConvertFrom-Json
        $version = [version]$info.ver
        if (-not (Test-SupportedVersion -Version $version)) {
            return $null
        }

        return @{
            Executable = [string]$info.exe
            Version = $version
        }
    } catch {
        return $null
    }
}

function Resolve-UvManagedPython {
    $uvCmd = Get-Command uv -ErrorAction SilentlyContinue
    if (-not $uvCmd) {
        return $null
    }

    New-Item -ItemType Directory -Path $uvCacheDir -Force | Out-Null

    foreach ($request in @("3.12", "3.11")) {
        try {
            $found = & $uvCmd.Source --cache-dir $uvCacheDir python find --system $request 2>$null
            if ($LASTEXITCODE -eq 0 -and $found) {
                $resolved = Resolve-PythonFromInvocation -Command $found.Trim()
                if ($resolved) {
                    return $resolved
                }
            }
        } catch {
            # try next request
        }
    }

    try {
        & $uvCmd.Source --cache-dir $uvCacheDir python install 3.12 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $found = & $uvCmd.Source --cache-dir $uvCacheDir python find --system 3.12 2>$null
            if ($LASTEXITCODE -eq 0 -and $found) {
                return Resolve-PythonFromInvocation -Command $found.Trim()
            }
        }
    } catch {
        # ignore; caller will throw consolidated error
    }

    return $null
}

function Resolve-CompatiblePython {
    param([string]$Preferred)

    if ($Preferred) {
        $resolvedPreferred = Resolve-PythonFromInvocation -Command $Preferred
        if ($resolvedPreferred) {
            return $resolvedPreferred
        }
        throw "Specified PythonCmd '$Preferred' is not usable or not Python 3.11/3.12."
    }

    foreach ($minor in @("3.12", "3.11")) {
        $fromPyLauncher = Resolve-PythonFromInvocation -Command "py" -PrefixArgs @("-$minor")
        if ($fromPyLauncher) {
            return $fromPyLauncher
        }
    }

    foreach ($candidate in @("python3.12", "python3.11", "python")) {
        $resolved = Resolve-PythonFromInvocation -Command $candidate
        if ($resolved) {
            return $resolved
        }
    }

    $fromUv = Resolve-UvManagedPython
    if ($fromUv) {
        return $fromUv
    }

    throw @"
No compatible Python interpreter found.
Required: Python 3.11 or 3.12 (project pins torch==2.3.0).

Fix options:
1) Install Python 3.12 and rerun this script.
2) If uv is installed, run: uv python install 3.12
3) Rerun with explicit interpreter:
   powershell -ExecutionPolicy Bypass -File .\scripts\seed_images.ps1 -PythonCmd "C:\path\to\python.exe"
"@
}

function Test-VenvPython {
    param([string]$PythonExe)
    if (-not (Test-Path $PythonExe)) {
        return $false
    }

    $resolved = Resolve-PythonFromInvocation -Command $PythonExe
    if ($resolved) {
        return $true
    }

    $venvRoot = Split-Path -Parent (Split-Path -Parent $PythonExe)
    $versionFromConfig = Get-VenvVersionFromConfig -VenvRoot $venvRoot
    return (Test-SupportedVersion -Version $versionFromConfig)
}

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Description,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Description failed with exit code $LASTEXITCODE"
    }
}

function Ensure-VenvPip {
    $pipReady = $false
    try {
        & $venvPython -m pip --version *> $null
        $pipReady = ($LASTEXITCODE -eq 0)
    } catch {
        $pipReady = $false
    }

    if ($pipReady) {
        return
    }

    Write-Host "[seed] pip missing in seed venv. Bootstrapping with ensurepip..."
    & $venvPython -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to bootstrap pip in seed virtual environment."
    }
}

if (-not (Test-VenvPython -PythonExe $venvPython)) {
    $python = Resolve-CompatiblePython -Preferred $PythonCmd
    Write-Host "[seed] Using Python $($python.Version) via $($python.Executable)"

    if (Test-Path $venvDir) {
        Write-Host "[seed] Removing unusable virtual environment at $venvDir"
        try {
            Remove-Item -LiteralPath $venvDir -Recurse -Force
        } catch {
            throw "Unable to recreate '$venvDir'. Close processes using the seed venv and rerun."
        }
    }
    Write-Host "[seed] Creating virtual environment at $venvDir (using --copies)"
    Invoke-Checked -Description "Virtual environment creation" -Command {
        & $python.Executable -m venv --copies $venvDir
    }
} else {
    Write-Host "[seed] Reusing virtual environment at $venvDir"
}

if (-not (Test-VenvPython -PythonExe $venvPython)) {
    throw "Failed to create a usable virtual environment at $venvDir"
}

Ensure-VenvPip

if (-not $SkipInstall) {
    Write-Host "[seed] Installing backend dependencies"
    Invoke-Checked -Description "Dependency installation" -Command {
        & $venvPython -m pip install -r (Join-Path $backendDir "requirements.txt")
    }
} else {
    Write-Host "[seed] Skipping dependency installation"
}

Write-Host "[seed] Running sample image seeding"
Invoke-Checked -Description "Sample image seeding" -Command {
    & $venvPython (Join-Path $backendDir "seed_images.py")
}

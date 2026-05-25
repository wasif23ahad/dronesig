param(
    [switch]$SkipInstall,
    [string]$PythonCmd = "",
    [switch]$UseCuda
)

$ErrorActionPreference = "Stop"

$backendDir = Split-Path -Parent $PSScriptRoot
$venvDir = Join-Path $backendDir "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsPath = Join-Path $backendDir "requirements.txt"
$envPath = Join-Path $backendDir ".env"
$envExamplePath = Join-Path $backendDir ".env.example"
$uvCacheDir = Join-Path $backendDir ".uv-cache"
$torchVersion = "2.3.0"
$torchVisionVersion = "0.18.0"

function Test-SupportedVersion {
    param([version]$Version)
    return ($Version -and $Version.Major -eq 3 -and $Version.Minor -ge 11 -and $Version.Minor -lt 13)
}

function Get-VenvVersionFromConfig {
    $cfgPath = Join-Path $venvDir "pyvenv.cfg"
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

    # If nothing compatible is already available, ask uv to install 3.12 then retry once.
    try {
        & $uvCmd.Source --cache-dir $uvCacheDir python install 3.12 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $found = & $uvCmd.Source --cache-dir $uvCacheDir python find --system 3.12 2>$null
            if ($LASTEXITCODE -eq 0 -and $found) {
                return Resolve-PythonFromInvocation -Command $found.Trim()
            }
        }
    } catch {
        # ignore; caller will throw a consolidated error
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
   powershell -ExecutionPolicy Bypass -File .\scripts\setup_backend.ps1 -PythonCmd "C:\path\to\python.exe"
"@
}

function Ensure-VenvInterpreterCompatible {
    if (-not (Test-Path $venvPython)) {
        return
    }

    $resolved = Resolve-PythonFromInvocation -Command $venvPython
    if ($resolved) {
        return
    }

    $versionFromConfig = Get-VenvVersionFromConfig
    if (Test-SupportedVersion -Version $versionFromConfig) {
        Write-Host "[backend] Venv probe failed, but pyvenv.cfg reports Python $versionFromConfig. Keeping existing venv."
        return
    }

    Write-Host "[backend] Existing venv uses incompatible Python. Recreating..."
    try {
        Remove-Item -LiteralPath $venvDir -Recurse -Force
    } catch {
        throw "Unable to recreate '$venvDir'. Close any process using backend\\venv (e.g., running API server) and run setup again."
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

    Write-Host "[backend] pip missing in venv. Bootstrapping with ensurepip..."
    & $venvPython -m ensurepip --upgrade
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to bootstrap pip in backend virtual environment."
    }
}

function Install-TorchRuntime {
    param([switch]$Cuda)

    if ($Cuda) {
        try {
            $cudaReady = & $venvPython -c "import importlib.metadata as m, torch; ok=(torch.__version__.startswith('2.3.0+cu121') and bool(torch.version.cuda) and m.version('numpy')=='1.26.4' and m.version('Pillow')=='10.3.0'); print(int(ok))" 2>$null
            if ($LASTEXITCODE -eq 0 -and $cudaReady.Trim() -eq "1") {
                Write-Host "[backend] CUDA PyTorch runtime already installed and compatible. Skipping reinstall."
                return
            }
        } catch {
            # Continue to installation path.
        }

        Write-Host "[backend] Installing CUDA-enabled PyTorch runtime (cu121)..."
        & $venvPython -m pip install `
            --index-url https://download.pytorch.org/whl/cu121 `
            --extra-index-url https://pypi.org/simple `
            --force-reinstall `
            "torch==$torchVersion+cu121" `
            "torchvision==$torchVisionVersion+cu121" `
            "numpy==1.26.4" `
            "Pillow==10.3.0"
    } else {
        Write-Host "[backend] Keeping default PyTorch runtime from requirements.txt"
        return
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install CUDA-enabled PyTorch runtime."
    }
}

Ensure-VenvInterpreterCompatible

if (-not (Test-Path $venvPython)) {
    $python = Resolve-CompatiblePython -Preferred $PythonCmd
    Write-Host "[backend] Using Python $($python.Version) via $($python.Executable)"
    Write-Host "[backend] Creating virtual environment..."
    & $python.Executable -m venv $venvDir
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create backend virtual environment."
    }
} else {
    Write-Host "[backend] Reusing virtual environment at $venvDir"
}

Ensure-VenvPip

if (-not $SkipInstall) {
    Write-Host "[backend] Installing dependencies..."
    & $venvPython -m pip install -r $requirementsPath
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install backend dependencies."
    }
    Install-TorchRuntime -Cuda:$UseCuda
} else {
    Write-Host "[backend] Skipping dependency installation."
}

if (-not (Test-Path $envPath)) {
    if (-not (Test-Path $envExamplePath)) {
        throw ".env.example not found at $envExamplePath"
    }

    Copy-Item $envExamplePath $envPath
    Write-Host "[backend] Created .env from .env.example"
} else {
    Write-Host "[backend] .env already exists."
}

Write-Host "[backend] Setup complete."
Write-Host "[backend] Run API: venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000"
if ($UseCuda) {
    Write-Host "[backend] CUDA requested. Verify with: venv\Scripts\python.exe -c `"import torch; print(torch.__version__, torch.version.cuda, torch.cuda.is_available())`""
}

# Shared runtime discovery. These helpers do not change the user's saved PATH.
function Resolve-SkillManagerNode {
    $skillManagerCandidates = @()
    if ($env:SKILL_MANAGER_NODE) { $skillManagerCandidates += $env:SKILL_MANAGER_NODE }
    $skillManagerNodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue
    if ($skillManagerNodeCommand) { $skillManagerCandidates += $skillManagerNodeCommand.Source }
    if ($env:CODEX_MCP_NODE_PATH) { $skillManagerCandidates += $env:CODEX_MCP_NODE_PATH }
    $skillManagerProfileDirectory = [Environment]::GetFolderPath('UserProfile')
    $skillManagerCandidates += Join-Path $skillManagerProfileDirectory '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if ($env:ProgramFiles) { $skillManagerCandidates += Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    foreach ($skillManagerCandidate in ($skillManagerCandidates | Select-Object -Unique)) {
        if (-not (Test-Path -LiteralPath $skillManagerCandidate -PathType Leaf)) { continue }
        try {
            $skillManagerVersion = & $skillManagerCandidate --version 2>$null
            if ($LASTEXITCODE -eq 0 -and "$skillManagerVersion" -match '^v(\d+)\.' -and [int]$Matches[1] -ge 24) {
                return (Get-Item -LiteralPath $skillManagerCandidate).FullName
            }
        } catch { continue }
    }
    throw 'Node.js 24 or newer was not found. Install Node.js 24+, or set SKILL_MANAGER_NODE to its node.exe path.'
}

function Get-SkillManagerRuntimeDirectories {
    param([string]$NodeExecutable)
    $skillManagerProfileDirectory = [Environment]::GetFolderPath('UserProfile')
    $skillManagerRuntimeDirectory = Join-Path $skillManagerProfileDirectory '.cache\codex-runtimes\codex-primary-runtime\dependencies'
    $skillManagerDirectories = @((Split-Path -Parent $NodeExecutable), (Join-Path $skillManagerRuntimeDirectory 'bin\fallback'))
    if (-not (Get-Command git -CommandType Application -ErrorAction SilentlyContinue)) {
        $skillManagerDirectories += Join-Path $skillManagerRuntimeDirectory 'native\git\cmd'
    }
    return @($skillManagerDirectories | Where-Object { Test-Path -LiteralPath $_ -PathType Container } | Select-Object -Unique)
}

function Resolve-SkillManagerPnpm {
    param([string]$NodeExecutable)
    $skillManagerProfileDirectory = [Environment]::GetFolderPath('UserProfile')
    $skillManagerModuleRoots = @(
        (Join-Path $skillManagerProfileDirectory '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules'),
        (Join-Path (Split-Path -Parent $NodeExecutable) 'node_modules'),
        (Join-Path (Split-Path -Parent (Split-Path -Parent $NodeExecutable)) 'node_modules')
    )
    if ($env:APPDATA) { $skillManagerModuleRoots += Join-Path $env:APPDATA 'npm\node_modules' }
    $skillManagerPnpmCommand = Get-Command pnpm -CommandType Application -ErrorAction SilentlyContinue
    if ($skillManagerPnpmCommand) { $skillManagerModuleRoots += Join-Path (Split-Path -Parent $skillManagerPnpmCommand.Source) 'node_modules' }
    foreach ($skillManagerModuleRoot in ($skillManagerModuleRoots | Select-Object -Unique)) {
        foreach ($skillManagerEntry in @('pnpm\bin\pnpm.mjs', 'pnpm\bin\pnpm.cjs')) {
            $skillManagerPnpmPath = Join-Path $skillManagerModuleRoot $skillManagerEntry
            if (Test-Path -LiteralPath $skillManagerPnpmPath -PathType Leaf) { return $skillManagerPnpmPath }
        }
    }
    throw 'pnpm was not found. Install pnpm for development. To open the already-built application, use start.cmd instead.'
}

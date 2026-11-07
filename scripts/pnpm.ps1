# Project-local development entry. No global pnpm command is required.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'runtime.ps1')
try {
    $skillManagerNode = Resolve-SkillManagerNode
    $skillManagerPnpm = Resolve-SkillManagerPnpm -NodeExecutable $skillManagerNode
    $skillManagerRuntimeDirectories = @(Get-SkillManagerRuntimeDirectories -NodeExecutable $skillManagerNode)
    $env:Path = (($skillManagerRuntimeDirectories + @($env:Path)) -join ';')
    $skillManagerRepo = Split-Path -Parent $PSScriptRoot
    & $skillManagerNode $skillManagerPnpm --dir $skillManagerRepo @args
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}

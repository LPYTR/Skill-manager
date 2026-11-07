param([string]$DataDirectory, [string]$ToolUserDirectory, [switch]$DryRun)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'runtime.ps1')
$skillManagerRepo = Split-Path -Parent $PSScriptRoot
$skillManagerCli = Join-Path $skillManagerRepo 'dist\cli.js'
if (-not (Test-Path -LiteralPath $skillManagerCli)) { throw 'Run scripts\pnpm.ps1 install and scripts\pnpm.ps1 build from the project directory first.' }
$skillManagerNode = Resolve-SkillManagerNode
$skillManagerRuntimeDirectories = @(Get-SkillManagerRuntimeDirectories -NodeExecutable $skillManagerNode)
$env:Path = (($skillManagerRuntimeDirectories + @($env:Path)) -join ';')
$skillManagerArguments = @($skillManagerCli)
if ($DataDirectory) { $skillManagerArguments += @('--home', $DataDirectory) }
if ($ToolUserDirectory) { $skillManagerArguments += @('--user-home', $ToolUserDirectory) }
if ($DryRun) { $skillManagerArguments += '--dry-run' }
$skillManagerArguments += @('bootstrap', '--json')
& $skillManagerNode @skillManagerArguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

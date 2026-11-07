param(
    [ValidateRange(0, 65535)][int]$Port = 4317,
    [switch]$NoOpen,
    [switch]$Check,
    [string]$DataDirectory,
    [string]$ToolUserDirectory
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'runtime.ps1')
try {
    $skillManagerRepo = Split-Path -Parent $PSScriptRoot
    $skillManagerCli = Join-Path $skillManagerRepo 'dist\cli.js'
    $skillManagerWeb = Join-Path $skillManagerRepo 'dist\web\index.html'
    if (-not (Test-Path -LiteralPath $skillManagerCli) -or -not (Test-Path -LiteralPath $skillManagerWeb)) {
        throw 'Build output is missing. Run scripts\pnpm.ps1 install, then scripts\pnpm.ps1 build from the project directory.'
    }
    $skillManagerNode = Resolve-SkillManagerNode
    $skillManagerRuntimeDirectories = @(Get-SkillManagerRuntimeDirectories -NodeExecutable $skillManagerNode)
    $env:Path = (($skillManagerRuntimeDirectories + @($env:Path)) -join ';')
    if ($Check) {
        $skillManagerNodeVersion = & $skillManagerNode --version
        [PSCustomObject]@{ ok = $true; data = @{ node = $skillManagerNode; nodeVersion = $skillManagerNodeVersion; cli = $skillManagerCli; port = $Port } } | ConvertTo-Json -Depth 3 -Compress
        exit 0
    }
    $skillManagerArguments = @($skillManagerCli)
    if ($DataDirectory) { $skillManagerArguments += @('--home', $DataDirectory) }
    if ($ToolUserDirectory) { $skillManagerArguments += @('--user-home', $ToolUserDirectory) }
    $skillManagerArguments += @('ui', '--port', "$Port", '--json')
    if ($NoOpen) { $skillManagerArguments += '--no-open' }
    & $skillManagerNode @skillManagerArguments
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}

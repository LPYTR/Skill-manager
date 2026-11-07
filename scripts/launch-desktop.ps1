param(
    [ValidateRange(1, 65535)][int]$Port = 4317,
    [switch]$NoOpen,
    [string]$DataDirectory,
    [string]$ToolUserDirectory
)
$ErrorActionPreference = 'Stop'
$skillManagerUrl = "http://127.0.0.1:$Port"
$skillManagerMutex = [Threading.Mutex]::new($false, "Local\SkillManagerDesktop-$Port")
$skillManagerLocked = $false
$skillManagerProcess = $null
function Test-SkillManagerReady {
    try {
        $skillManagerSession = Invoke-RestMethod "$skillManagerUrl/api/session" -TimeoutSec 2
        if (-not $skillManagerSession.ok -or -not $skillManagerSession.data.token) { return $false }
        $skillManagerInfo = Invoke-RestMethod "$skillManagerUrl/api/info" -Headers @{ 'x-skill-manager-token' = $skillManagerSession.data.token } -TimeoutSec 2
        return ($skillManagerInfo.ok -and $skillManagerInfo.data.home -and $skillManagerInfo.data.command -and $skillManagerInfo.data.version)
    } catch { return $false }
}
try {
    try { $skillManagerLocked = $skillManagerMutex.WaitOne(45000) }
    catch [Threading.AbandonedMutexException] { $skillManagerLocked = $true }
    if (-not $skillManagerLocked) { throw 'Another Skill Manager launcher is still starting. Please try again shortly.' }
    $skillManagerReused = Test-SkillManagerReady
    if (-not $skillManagerReused) {
        $skillManagerRepo = Split-Path -Parent $PSScriptRoot
        $skillManagerStdout = Join-Path $env:TEMP "skill-manager-desktop-$Port.stdout.log"
        $skillManagerStderr = Join-Path $env:TEMP "skill-manager-desktop-$Port.stderr.log"
        $skillManagerArguments = @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'start.ps1') + '"'), '-Port', "$Port", '-NoOpen')
        if ($DataDirectory) { $skillManagerArguments += @('-DataDirectory', ('"' + $DataDirectory + '"')) }
        if ($ToolUserDirectory) { $skillManagerArguments += @('-ToolUserDirectory', ('"' + $ToolUserDirectory + '"')) }
        $skillManagerProcess = Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $skillManagerArguments -WorkingDirectory $skillManagerRepo -WindowStyle Hidden -RedirectStandardOutput $skillManagerStdout -RedirectStandardError $skillManagerStderr -PassThru
        $skillManagerDeadline = [DateTime]::UtcNow.AddSeconds(30)
        $skillManagerReady = $false
        do {
            $skillManagerReady = Test-SkillManagerReady
            if ($skillManagerReady) { break }
            $skillManagerProcess.Refresh()
            if ($skillManagerProcess.HasExited) { break }
            Start-Sleep -Milliseconds 250
        } while ([DateTime]::UtcNow -lt $skillManagerDeadline)
        if (-not $skillManagerReady) { throw "Skill Manager could not start. Check port $Port and the log: $skillManagerStderr" }
    }
    if (-not $NoOpen) { Start-Process $skillManagerUrl }
    [pscustomobject]@{ ok = $true; url = $skillManagerUrl; reused = [bool]$skillManagerReused } | ConvertTo-Json -Compress
} catch {
    $skillManagerFailure = $_.Exception.Message
    if (-not $NoOpen) {
        Add-Type -AssemblyName System.Windows.Forms
        [void][System.Windows.Forms.MessageBox]::Show($skillManagerFailure, 'Skill Manager', 'OK', 'Error')
    }
    [Console]::Error.WriteLine($skillManagerFailure)
    exit 1
} finally {
    if ($skillManagerLocked) { $skillManagerMutex.ReleaseMutex() }
    $skillManagerMutex.Dispose()
}

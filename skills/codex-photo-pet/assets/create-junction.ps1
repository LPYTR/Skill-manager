param([Parameter(Mandatory=$true)][string]$LinkPath,
      [Parameter(Mandatory=$true)][string]$TargetPath)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $LinkPath) { throw 'Link destination already exists.' }
New-Item -ItemType Junction -Path $LinkPath -Target ([System.Management.Automation.WildcardPattern]::Escape($TargetPath)) | Out-Null

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
foreach ($name in @('server','ssh')) {
  $record=Join-Path $projectRoot ('.run\'+$name+'-process.json')
  if (-not (Test-Path -LiteralPath $record)) { continue }
  $owned=Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
  $process=Get-Process -Id $owned.pid -ErrorAction SilentlyContinue
  if (-not $process) { Write-Output "$name already stopped"; continue }
  $sameStart=$process.StartTime.ToUniversalTime().Ticks -eq ([DateTime]$owned.started).ToUniversalTime().Ticks
  $expectedPath=$owned.path
  if (-not $expectedPath -and $sameStart) {
    if ($name -eq 'server') {
      $allowedPaths=@((Join-Path $projectRoot '.run\service\music-practice.exe'),(Join-Path $projectRoot 'target\debug\music-practice.exe'),(Join-Path $projectRoot 'target\release\music-practice.exe'))
      if ($allowedPaths -contains $process.Path) { $expectedPath=$process.Path }
    } else { $expectedPath=(Get-Command ssh -ErrorAction Stop).Source }
  }
  if ($process.Path -ne $expectedPath -or -not $sameStart) { Write-Output "$name process identity changed; left untouched"; continue }
  if ($name -eq 'server' -and -not $process.Path.StartsWith($projectRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to stop a process outside this project' }
  Stop-Process -Id $process.Id
  Write-Output "Stopped owned $name PID $($process.Id)"
}

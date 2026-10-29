param([int]$Port=3210,[int]$VlmPort=18080,[switch]$NoVlm,[string]$VlmSshHost=$env:MUSIC_VLM_SSH_HOST,[int]$VlmRemotePort=8000)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runRoot = Join-Path $projectRoot '.run'
New-Item -ItemType Directory -Path $runRoot -Force | Out-Null
function Save-OwnedProcess($process, $name, $expectedPath) {
  @{pid=$process.Id;started=$process.StartTime.ToUniversalTime().ToString('o');path=[IO.Path]::GetFullPath($expectedPath)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runRoot ($name+'-process.json')) -Encoding UTF8
}
if (-not $NoVlm) {
  $modelsReady=$false
  try { $models=Invoke-RestMethod -Uri "http://127.0.0.1:$VlmPort/v1/models" -TimeoutSec 3; $modelsReady=[bool]$models.data } catch {}
  if (-not $modelsReady -and -not $VlmSshHost) { Write-Output "VLM endpoint http://127.0.0.1:$VlmPort not reachable; continuing without SSH tunnel. Pass -VlmSshHost <host> or set MUSIC_VLM_SSH_HOST to enable forwarding." }
    if (-not $modelsReady -and $VlmSshHost) {
    if (Get-NetTCPConnection -LocalPort $VlmPort -State Listen -ErrorAction SilentlyContinue) { throw "VLM port $VlmPort is occupied; no process was stopped" }
    $ssh=(Get-Command ssh -ErrorAction Stop).Source
    $tunnel=Start-Process -FilePath $ssh -ArgumentList @('-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','HostKeyAlgorithms=ecdsa-sha2-nistp256,rsa-sha2-512,rsa-sha2-256','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-L',"127.0.0.1:${VlmPort}:127.0.0.1:${VlmRemotePort}",$VlmSshHost) -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $runRoot 'ssh-error.log') -RedirectStandardOutput (Join-Path $runRoot 'ssh-out.log')
    Save-OwnedProcess $tunnel 'ssh' $ssh
    Write-Output "VLM forwarding started ($VlmSshHost); log: $runRoot\ssh-error.log"
  }
}
try { $health=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2; if ($health.ok) { Write-Output "Already running: http://127.0.0.1:$Port"; exit 0 } } catch {}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw "Port $Port is occupied; no process was stopped" }
$candidates=@((Join-Path $projectRoot 'target\release\music-practice.exe'),(Join-Path $projectRoot 'target\debug\music-practice.exe'))
$built=@($candidates | Where-Object { Test-Path -LiteralPath $_ } | Get-Item | Sort-Object LastWriteTime -Descending)
if (-not $built.Count) { throw 'Build first: scripts\Build.ps1' }
$binary=$built[0].FullName
$serviceRoot=Join-Path $runRoot 'service'
New-Item -ItemType Directory -Path $serviceRoot -Force | Out-Null
$serviceBinary=Join-Path $serviceRoot 'music-practice.exe'
Copy-Item -LiteralPath $binary -Destination $serviceBinary -Force
$env:MUSIC_DATA=Join-Path $projectRoot 'data'
$env:MUSIC_PORT="$Port"
$service=Start-Process -FilePath $serviceBinary -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runRoot 'server.log') -RedirectStandardError (Join-Path $runRoot 'server-error.log')
Save-OwnedProcess $service 'server' $serviceBinary
$ready=$false
for ($attempt=0; $attempt -lt 30; $attempt++) {
  try { $health=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 1; if ($health.ok) { $ready=$true; break } } catch {}
  Start-Sleep -Milliseconds 200
}
if (-not $ready) { throw "Service did not become ready; see $runRoot\server-error.log" }
Write-Output "Started PID $($service.Id): http://127.0.0.1:$Port"

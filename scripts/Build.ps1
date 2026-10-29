param([switch]$Release)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $projectRoot
try {
  $env:CARGO_HOME = Join-Path $projectRoot '.tools\cargo'
  $env:RUSTUP_HOME = Join-Path $projectRoot '.tools\rustup'
  $env:CARGO_INCREMENTAL = '0'
  $cargo = Join-Path $env:CARGO_HOME 'bin\cargo.exe'
  if (-not (Test-Path -LiteralPath $cargo)) { $cargo = (Get-Command cargo -ErrorAction Stop).Source }
  & $cargo test
  if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
  & node node_modules/tsx/dist/cli.mjs --test 'web/*.test.ts' 'web/audio/*.test.ts'
  if ($LASTEXITCODE -ne 0) { throw 'Web tests failed' }
  & node node_modules/typescript/bin/tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed' }
  & node node_modules/vite/bin/vite.js build
  if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
  if ($Release) { & $cargo build --release } else { & $cargo build }
  if ($LASTEXITCODE -ne 0) { throw 'Rust build failed' }
} finally { Pop-Location }

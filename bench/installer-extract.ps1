param(
  # An installed Boite directory: the files the update installer writes.
  [string]$Install = "$env:LOCALAPPDATA\Boite",
  # A scratch directory; the copy, the test installers and their output go there.
  [Parameter(Mandatory = $true)][string]$Work,
  [string]$Makensis = "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe",
  [int]$Runs = 3
)

# How long the update installer takes to write the app's files with each NSIS
# compressor, the time between the old window closing and the new one opening.
# The files are packed the way Tauri's template packs them (`SetCompressor
# /SOLID`) into an installer that only extracts them, run silent into $Work.
# Nothing of the real install is touched: no hook, no shortcut, no registry.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Work | Out-Null
$payload = Join-Path $Work 'payload'
if (-not (Test-Path $payload)) {
  robocopy $Install $payload /E /NFL /NDL /NJH /NJS /XF uninstall.exe *.old | Out-Null
}
$files = Get-ChildItem $payload -Recurse -File | Measure-Object Length -Sum
'payload: {0} files, {1:N0} bytes' -f $files.Count, $files.Sum

Set-Content (Join-Path $Work 'extract.nsi') @'
Unicode true
!if "${COMP}" == "none"
  SetCompress off
!else
  SetCompressor /SOLID ${COMP}
!endif
Name "extract"
OutFile "extract-${COMP}.exe"
RequestExecutionLevel user
SilentInstall silent
InstallDir "$TEMP\boite-extract"
Section
  SetOutPath $INSTDIR
  File /r "payload\*.*"
SectionEnd
'@

$compressors = 'lzma', 'zlib', 'bzip2', 'none'
Push-Location $Work
try {
  foreach ($c in $compressors) {
    $built = Measure-Command { & $Makensis /V1 "/DCOMP=$c" extract.nsi | Out-Null }
    '{0}: installer {1:N0} bytes, built in {2:N1} s' -f $c, (Get-Item "extract-$c.exe").Length, $built.TotalSeconds
  }
} finally { Pop-Location }

$times = @{}
foreach ($round in 1..$Runs) {
  foreach ($c in $compressors) {
    $out = Join-Path $Work "out-$c"
    if (Test-Path $out) { Remove-Item $out -Recurse -Force }
    $t = Measure-Command { Start-Process -Wait -FilePath (Join-Path $Work "extract-$c.exe") -ArgumentList '/S', "/D=$out" }
    $times[$c] += @($t.TotalSeconds)
    Remove-Item $out -Recurse -Force
  }
}
foreach ($c in $compressors) {
  $sorted = $times[$c] | Sort-Object
  '{0}: extracted in {1:N2} s (median of {2})' -f $c, $sorted[[int][math]::Floor($sorted.Count / 2)], $Runs
}

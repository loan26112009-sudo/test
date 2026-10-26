# Reframe 360 Pro - desinstallation Windows
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.reframe360.pro'
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force; Write-Host "Supprime : $dest" -ForegroundColor Green }
else { Write-Host 'Reframe 360 Pro n''est pas installe.' }
$data = Join-Path $env:APPDATA 'Reframe360Pro'
if (Test-Path $data) {
  $a = Read-Host 'Supprimer aussi les cadrages enregistres (cles) ? (o/N)'
  if ($a -eq 'o') { Remove-Item $data -Recurse -Force; Write-Host 'Cadrages supprimes.' }
}
$cache = Join-Path $env:TEMP 'Reframe360Pro'
if (Test-Path $cache) { Remove-Item $cache -Recurse -Force }

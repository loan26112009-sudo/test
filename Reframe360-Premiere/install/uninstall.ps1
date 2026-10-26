# Reframe 360 Pro - desinstallation Windows
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.reframe360.pro'
if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
  Write-Host 'Ferme Premiere Pro avant de desinstaller.' -ForegroundColor Yellow
  Read-Host 'Puis appuie sur Entree'
}
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force; Write-Host "Supprime : $dest" -ForegroundColor Green }
else { Write-Host 'Reframe 360 Pro n''est pas installe.' }
$cache = Join-Path $env:TEMP 'Reframe360Pro'
if (Test-Path $cache) { Remove-Item $cache -Recurse -Force -ErrorAction SilentlyContinue; Write-Host 'Cache d''apercu supprime.' }
$data = Join-Path $env:APPDATA 'Reframe360Pro'
if (Test-Path $data) {
  $a = Read-Host 'Supprimer aussi tes cadrages enregistres (images cles) ? (o/N)'
  if ($a -eq 'o') { Remove-Item $data -Recurse -Force; Write-Host 'Cadrages supprimes.' }
}
Write-Host 'Les fichiers deja rendus (dossiers Reframe360 a cote de tes videos) ne sont pas touches.'

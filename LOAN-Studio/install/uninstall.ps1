# LOAN Studio - desinstallation Windows
$extRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
  Write-Host 'Ferme Premiere Pro avant de desinstaller.' -ForegroundColor Yellow
  Read-Host 'Puis appuie sur Entree'
}
foreach ($id in @('com.loanstudio', 'com.reframe360.pro')) {
  $d = Join-Path $extRoot $id
  if (Test-Path $d) { Remove-Item $d -Recurse -Force; Write-Host "Supprime : $d" -ForegroundColor Green }
}
foreach ($c in @('LoanStudio', 'Reframe360Pro')) {
  $cache = Join-Path $env:TEMP $c
  if (Test-Path $cache) { Remove-Item $cache -Recurse -Force -ErrorAction SilentlyContinue }
}
$data = @((Join-Path $env:APPDATA 'LoanStudio'), (Join-Path $env:APPDATA 'Reframe360Pro')) | Where-Object { Test-Path $_ }
if ($data) {
  $a = Read-Host 'Supprimer aussi tes donnees (planning, structures, cadrages 360) ? (o/N)'
  if ($a -eq 'o') { $data | ForEach-Object { Remove-Item $_ -Recurse -Force }; Write-Host 'Donnees supprimees.' }
}
Write-Host 'Tes videos, proxies, placeholders et copies de secours ne sont pas touches.'

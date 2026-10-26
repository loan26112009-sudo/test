# LOAN Studio (+ Reframe 360) - installation Windows (aucun droit administrateur requis)
# Compatible Windows PowerShell 5.1 (Windows 10 / 11). Journal : %TEMP%\reframe360-install.log
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$log = Join-Path $env:TEMP 'loanstudio-install.log'
try { Start-Transcript -Path $log -Force | Out-Null } catch {}

function Ok($m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Info($m) { Write-Host "       $m" }
function Fail($m) {
  Write-Host ''
  Write-Host "  [X]  $m" -ForegroundColor Red
  Write-Host "       Journal complet : $log"
  try { Stop-Transcript | Out-Null } catch {}
  exit 1
}

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$src  = Join-Path $root 'extension'
$extRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$dest = Join-Path $extRoot 'com.loanstudio'
$old  = Join-Path $extRoot 'com.reframe360.pro'

Write-Host ''
Write-Host '  LOAN STUDIO - installation pour Adobe Premiere Pro' -ForegroundColor Cyan
Write-Host '  =================================================='
Write-Host ''

# 0. Verifications
if (-not (Test-Path (Join-Path $src 'CSXS\manifest.xml'))) {
  Fail "Dossier 'extension' introuvable a cote du script. As-tu bien EXTRAIT le ZIP (clic droit > Extraire tout) avant de lancer Install-Windows.bat ?"
}
if ($root -like "*\AppData\Local\Temp\*") {
  Warn "Tu sembles lancer l'installateur depuis l'interieur du ZIP. Si une erreur apparait, extrais d'abord le ZIP."
}

$premieres = @()
foreach ($base in @("$env:ProgramFiles\Adobe", "${env:ProgramFiles(x86)}\Adobe")) {
  if ($base -and (Test-Path $base)) {
    $premieres += Get-ChildItem -Path $base -Directory -Filter 'Adobe Premiere Pro*' -ErrorAction SilentlyContinue | ForEach-Object { $_.Name }
  }
}
if ($premieres.Count -gt 0) { Ok ("Premiere Pro detecte : " + ($premieres -join ', ')) }
else { Warn "Premiere Pro introuvable dans Program Files (installe ailleurs ?). L'installation continue." }

while (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
  Warn 'Premiere Pro est ouvert : enregistre ton projet et FERME Premiere.'
  Read-Host '       Puis appuie sur Entree pour continuer'
}

# 1. Copie de l'extension (on conserve un FFmpeg deja telecharge)
Write-Host ''
Write-Host '  [1/4] Copie du panneau...'
$savedBin = $null
foreach ($prev in @($dest, $old)) {
  if (-not $savedBin -and (Test-Path (Join-Path $prev 'bin\ffmpeg.exe'))) {
    $savedBin = Join-Path $env:TEMP 'loanstudio-bin'
    if (Test-Path $savedBin) { Remove-Item $savedBin -Recurse -Force }
    Copy-Item (Join-Path $prev 'bin') $savedBin -Recurse -Force
  }
}
# l'ancienne extension "Reframe 360 Pro" est remplacee par LOAN Studio (qui contient Reframe 360)
if (Test-Path $old) { Remove-Item $old -Recurse -Force; Info 'Ancienne extension Reframe 360 Pro remplacee.' }
try {
  if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  Copy-Item (Join-Path $src '*') $dest -Recurse -Force
} catch {
  Fail "Copie impossible vers $dest : $($_.Exception.Message)"
}
$bin = Join-Path $dest 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
if ($savedBin) { Copy-Item (Join-Path $savedBin '*') $bin -Recurse -Force; Remove-Item $savedBin -Recurse -Force }
# Fichiers venant d'un ZIP telecharge : on retire la marque "provenant d'Internet"
Get-ChildItem -Path $dest -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
Ok "Panneau installe dans $dest"

# 2. Autoriser les extensions non signees (CSXS 9 a 15 = Premiere 2019 a 2027)
Write-Host '  [2/4] Autorisation des extensions...'
foreach ($v in 9..15) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}
Ok 'PlayerDebugMode = 1 (CSXS.9 a CSXS.15)'

# 3. FFmpeg (decodage H.265 10 bits / 8K, encodage ProRes et DNxHR)
Write-Host '  [3/4] FFmpeg...'
$ff = Join-Path $bin 'ffmpeg.exe'
if (-not (Test-Path $ff)) {
  $urls = @(
    'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
  )
  foreach ($u in $urls) {
    try {
      Info "Telechargement (environ 90 Mo, 1 a 3 minutes) : $u"
      $zip = Join-Path $env:TEMP 'loanstudio-ffmpeg.zip'
      $tmp = Join-Path $env:TEMP 'loanstudio-ffmpeg'
      Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing
      if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $tmp -Force
      foreach ($exe in @('ffmpeg.exe', 'ffprobe.exe')) {
        $f = Get-ChildItem -Path $tmp -Recurse -Filter $exe | Select-Object -First 1
        if ($f) { Copy-Item $f.FullName $bin -Force }
      }
      Remove-Item $zip -Force -ErrorAction SilentlyContinue
      Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
      if (Test-Path $ff) { break }
    } catch {
      Warn "Echec : $($_.Exception.Message)"
    }
  }
}
$ffOk = $false
if (Test-Path $ff) {
  try {
    $ver = (& $ff -hide_banner -version | Select-Object -First 1)
    $enc = (& $ff -hide_banner -encoders) -join "`n"
    $missing = @('prores_ks', 'dnxhd', 'libx265', 'libx264') | Where-Object { $enc -notmatch (' ' + $_ + ' ') }
    Ok "FFmpeg pret : $ver"
    if ($missing) { Warn ("Encodeurs absents dans ce FFmpeg : " + ($missing -join ', ')) }
    $ffOk = $true
  } catch { Warn "ffmpeg.exe present mais ne demarre pas : $($_.Exception.Message)" }
} elseif (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Ok 'FFmpeg trouve dans le PATH, il sera utilise.'
  $ffOk = $true
} else {
  Warn 'FFmpeg non installe automatiquement (pas d''Internet, antivirus ou proxy ?).'
  Info '1. Telecharge https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
  Info "2. Copie ffmpeg.exe et ffprobe.exe (dossier bin du ZIP) dans : $bin"
}

# 4. Verification finale
Write-Host '  [4/4] Verification...'
$need = @('CSXS\manifest.xml', 'studio\index.html', 'host\studio.jsx', 'reframe\index.html', 'host\reframe.jsx', 'shared\js\ffmpeg.js')
$bad = $need | Where-Object { -not (Test-Path (Join-Path $dest $_)) }
if ($bad) { Fail ("Fichiers manquants apres copie : " + ($bad -join ', ')) }
Ok 'Tous les fichiers du panneau sont en place'

Write-Host ''
if ($ffOk) { Write-Host '  INSTALLATION REUSSIE' -ForegroundColor Green }
else { Write-Host '  INSTALLE - il reste a ajouter FFmpeg (voir ci-dessus)' -ForegroundColor Yellow }
Write-Host ''
Write-Host '  Ouvre Premiere Pro, puis : Fenetre > Extensions > LOAN Studio' -ForegroundColor Cyan
Write-Host '  (Reframe 360 : Fenetre > Extensions > LOAN Studio - Reframe 360)' -ForegroundColor Cyan
Write-Host "  Journal : $log"
Write-Host ''
try { Stop-Transcript | Out-Null } catch {}

# Reframe 360 Pro - installation Windows (aucun droit administrateur requis)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$src  = Join-Path $root 'extension'
$dest = Join-Path $env:APPDATA 'Adobe\CEP\extensions\com.reframe360.pro'

Write-Host ''
Write-Host '  REFRAME 360 PRO - installation pour Adobe Premiere Pro' -ForegroundColor Cyan
Write-Host '  ------------------------------------------------------'
Write-Host ''

if (-not (Test-Path (Join-Path $src 'CSXS\manifest.xml'))) { throw "Dossier 'extension' introuvable a cote du script ($src)." }

if (Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue) {
  Write-Host '  ! Premiere Pro est ouvert : ferme-le avant de continuer.' -ForegroundColor Yellow
  Read-Host '  Appuie sur Entree quand Premiere est ferme'
}

# 1. Copie de l'extension (on garde un FFmpeg deja telecharge)
$savedBin = $null
if (Test-Path (Join-Path $dest 'bin\ffmpeg.exe')) {
  $savedBin = Join-Path $env:TEMP 'reframe360-bin'
  if (Test-Path $savedBin) { Remove-Item $savedBin -Recurse -Force }
  Copy-Item (Join-Path $dest 'bin') $savedBin -Recurse -Force
}
if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
New-Item -ItemType Directory -Path $dest -Force | Out-Null
Copy-Item (Join-Path $src '*') $dest -Recurse -Force
$bin = Join-Path $dest 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
if ($savedBin) { Copy-Item (Join-Path $savedBin '*') $bin -Recurse -Force; Remove-Item $savedBin -Recurse -Force }
Write-Host "  [1/3] Extension copiee dans $dest" -ForegroundColor Green

# 2. Autoriser les extensions non signees (CEP 9 a 13 = Premiere 2019 a 2026)
foreach ($v in 9..13) {
  $key = "HKCU:\Software\Adobe\CSXS.$v"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name 'PlayerDebugMode' -Value '1' -Type String
}
Write-Host '  [2/3] Mode extensions active (PlayerDebugMode)' -ForegroundColor Green

# 3. FFmpeg (decodage H.265 10 bits / encodage ProRes, DNxHR)
$ff = Join-Path $bin 'ffmpeg.exe'
if (-not (Test-Path $ff)) {
  $urls = @(
    'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
  )
  foreach ($u in $urls) {
    try {
      Write-Host "  [3/3] Telechargement de FFmpeg ($u)..."
      $zip = Join-Path $env:TEMP 'reframe360-ffmpeg.zip'
      $tmp = Join-Path $env:TEMP 'reframe360-ffmpeg'
      Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing
      if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
      Expand-Archive -Path $zip -DestinationPath $tmp -Force
      foreach ($exe in 'ffmpeg.exe', 'ffprobe.exe') {
        $f = Get-ChildItem -Path $tmp -Recurse -Filter $exe | Select-Object -First 1
        if ($f) { Copy-Item $f.FullName $bin -Force }
      }
      Remove-Item $zip -Force; Remove-Item $tmp -Recurse -Force
      if (Test-Path $ff) { break }
    } catch {
      Write-Host "        echec : $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}
if (Test-Path $ff) {
  $ver = (& $ff -hide_banner -version | Select-Object -First 1)
  Write-Host "  [3/3] FFmpeg pret : $ver" -ForegroundColor Green
} elseif (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
  Write-Host '  [3/3] FFmpeg trouve dans le PATH, il sera utilise.' -ForegroundColor Green
} else {
  Write-Host '  [3/3] FFmpeg non installe. Telecharge-le sur https://www.gyan.dev/ffmpeg/builds/' -ForegroundColor Yellow
  Write-Host "        puis copie ffmpeg.exe et ffprobe.exe dans : $bin" -ForegroundColor Yellow
}

Write-Host ''
Write-Host '  Termine ! Lance Premiere Pro puis : Fenetre > Extensions > Reframe 360 Pro' -ForegroundColor Cyan
Write-Host ''

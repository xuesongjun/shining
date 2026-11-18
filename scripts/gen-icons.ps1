Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $root 'assets'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

function New-RoundedPath([double]$size, [double]$radius) {
  $d = $radius * 2
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc(0, 0, $d, $d, 180, 90)
  $p.AddArc($size - $d, 0, $d, $d, 270, 90)
  $p.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
  $p.AddArc(0, $size - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# 四角星：四条内凹的贝塞尔曲线
function Add-Spark($g, [double]$cx, [double]$cy, [double]$r, $brush) {
  $k = $r * 0.16
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddBezier($cx, $cy - $r, $cx + $k, $cy - $k, $cx + $k, $cy - $k, $cx + $r, $cy)
  $p.AddBezier($cx + $r, $cy, $cx + $k, $cy + $k, $cx + $k, $cy + $k, $cx, $cy + $r)
  $p.AddBezier($cx, $cy + $r, $cx - $k, $cy + $k, $cx - $k, $cy + $k, $cx - $r, $cy)
  $p.AddBezier($cx - $r, $cy, $cx - $k, $cy - $k, $cx - $k, $cy - $k, $cx, $cy - $r)
  $p.CloseFigure()
  $g.FillPath($brush, $p)
  $p.Dispose()
}

# 闪灵图标：墨底 + 纸白四角星
function New-ShiningIcon {
  param([int]$Size, [string]$OutPath)

  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)

  $shape = New-RoundedPath $Size ([double]$Size * 0.235)
  $bg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 20, 32, 30))
  $g.FillPath($bg, $shape)

  $paper = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 247, 247, 244))
  Add-Spark $g ([double]$Size * 0.5) ([double]$Size * 0.485) ([double]$Size * 0.27) $paper

  $g.Dispose()
  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

New-ShiningIcon -Size 256 -OutPath (Join-Path $assets 'icon.png')
New-ShiningIcon -Size 64 -OutPath (Join-Path $assets 'icon@64.png')
New-ShiningIcon -Size 32 -OutPath (Join-Path $assets 'tray.png')
Write-Output "icons written to $assets"

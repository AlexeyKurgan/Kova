param(
    [string]$Output = (Join-Path $PSScriptRoot '..\apps\desktop\src-tauri\icon-source.png')
)

Add-Type -AssemblyName System.Drawing

$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::Transparent)

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$path.AddArc(64, 64, 320, 320, 180, 90)
$path.AddArc(640, 64, 320, 320, 270, 90)
$path.AddArc(640, 640, 320, 320, 0, 90)
$path.AddArc(64, 640, 320, 320, 90, 90)
$path.CloseFigure()

$surface = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 21, 26, 33))
$graphics.FillPath($surface, $path)

$border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 216, 166, 87), 22)
$graphics.DrawPath($border, $path)

$font = New-Object System.Drawing.Font('Segoe UI', 560, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 216, 166, 87))
$rect = New-Object System.Drawing.RectangleF(0, -28, $size, $size)
$graphics.DrawString('K', $font, $textBrush, $rect, $format)

$graphics.Dispose()
$bmp.Save($Output, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output $Output

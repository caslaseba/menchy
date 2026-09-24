$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = Join-Path $desktop 'Menchy.lnk'
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = Join-Path $root 'iniciar.bat'
$link.WorkingDirectory = $root
$link.Description = 'Menchy - almacen'
$link.WindowStyle = 1
$link.Save()
Write-Host "Acceso creado en el escritorio: $shortcut"

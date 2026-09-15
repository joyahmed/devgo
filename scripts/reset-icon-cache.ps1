# Rebuild the Windows shell icon cache.
#
# DevGo is reinstalled several times a day into the same path, and Explorer
# caches the icon it extracts from an exe by path. The taskbar falls back to
# that cache whenever the window has not handed over a usable icon yet, and a
# stale entry is a blank button no matter what the window says. lib.rs sets
# the window icons explicitly so the fallback is rarely taken; this clears
# the cache for the times it still is.
#
# Run as the logged-in user, not elevated: the cache files are per-user and
# explorer.exe must restart in this session. A script you run, not something
# the app does: restarting the user's shell is not a launcher's call.

$cacheDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Explorer'

Write-Host 'Stopping Explorer...'
Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

Write-Host "Deleting $cacheDir\iconcache_*.db ..."
Get-ChildItem -Path $cacheDir -Filter 'iconcache_*.db' -Force -ErrorAction SilentlyContinue |
    Remove-Item -Force -ErrorAction SilentlyContinue

# -show is the Windows 10/11 spelling; -ClearIconCache was Windows 8
Write-Host 'Clearing the in-memory icon cache (ie4uinit -show)...'
Start-Process -FilePath 'ie4uinit.exe' -ArgumentList '-show' -Wait -ErrorAction SilentlyContinue

Write-Host 'Restarting Explorer...'
Start-Process -FilePath 'explorer.exe'

Write-Host 'Done. Launch DevGo again; the taskbar will extract a fresh icon.'

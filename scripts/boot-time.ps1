<#
How long DevGo takes to appear. Starts the exe, polls its window title every
100 ms (a hidden window has none, so a title is proof the whole path ran:
setup, the webview, the frontend's show), then reads the first-list mark
from startup.log, which the app writes only while DEVGO_STARTUP_LOG=1.

    scripts\boot-time.ps1                    release exe, 5 runs, after a clean quit
    scripts\boot-time.ps1 -Stale             leave the lock behind between runs (a killed DevGo)
    scripts\boot-time.ps1 -Exe p -Runs 10 -BudgetMs 1000

A budget is only meaningful on release: a debug build measures the compiler.
Stop the installed DevGo first; it shares the app data and the instance lock.
#>
param(
	[string] $Exe = (Join-Path $PSScriptRoot '..\src-tauri\target\release\devgo.exe'),
	[int] $Runs = 5,
	[int] $BudgetMs = 0,
	[switch] $Stale,
	[int] $TimeoutS = 25
)
$ErrorActionPreference = 'Stop'

$conf = Get-Content (Join-Path $PSScriptRoot '..\src-tauri\tauri.conf.json') | ConvertFrom-Json
$lock = Join-Path $env:APPDATA "$($conf.identifier)\instance.lock"
$log = Join-Path $env:LOCALAPPDATA 'DevGo\startup.log'
if (-not (Test-Path $Exe)) { throw "no exe at $Exe" }
if (Get-Process devgo -ErrorAction SilentlyContinue) { throw 'a DevGo is running; stop it first' }

# the lock is what a kill leaves and a quit removes: the runs start from
# the state asked for, not from whatever the last one left
if (-not $Stale) { Remove-Item $lock -ErrorAction SilentlyContinue }

$visible = @()
$first = @()
try {
	$env:DEVGO_STARTUP_LOG = '1'
	for ($i = 1; $i -le $Runs; $i++) {
		Remove-Item $log -ErrorAction SilentlyContinue
		$clock = [System.Diagnostics.Stopwatch]::StartNew()
		$p = Start-Process -FilePath $Exe -PassThru
		$ms = -1
		while ($clock.ElapsedMilliseconds -lt $TimeoutS * 1000) {
			$p.Refresh()
			if ($p.HasExited) { break }
			if ($p.MainWindowTitle -ne '') { $ms = $clock.ElapsedMilliseconds; break }
			Start-Sleep -Milliseconds 100
		}
		# the frontend marks first-list the frame after the cached list paints
		$fl = ''
		$until = $clock.ElapsedMilliseconds + 1500
		while ($clock.ElapsedMilliseconds -lt $until) {
			if (Test-Path $log) {
				$line = Get-Content $log | Where-Object { $_ -like 'first-list,*' } | Select-Object -Last 1
				if ($line) { $fl = $line.Split(',')[1]; break }
			}
			Start-Sleep -Milliseconds 50
		}
		$p.Refresh()
		if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
		if (-not $Stale) { Start-Sleep -Milliseconds 300; Remove-Item $lock -ErrorAction SilentlyContinue }
		if ($ms -lt 0) { throw "run $i`: no window within ${TimeoutS}s (exited: $($p.HasExited))" }
		$visible += $ms
		if ($fl) { $first += [int]$fl }
		$flText = if ($fl) { " · first-list $fl ms (process clock)" } else { ' · no first-list mark' }
		Write-Host "run $i`: window visible at $ms ms$flText"
		Start-Sleep -Seconds 1
	}
}
finally {
	Remove-Item Env:\DEVGO_STARTUP_LOG -ErrorAction SilentlyContinue
}

$mode = if ($Stale) { 'after a kill (stale lock)' } else { 'after a clean quit' }
$flSummary = if ($first.Count) { ", first list $(($first | Measure-Object -Minimum).Minimum)-$(($first | Measure-Object -Maximum).Maximum) ms" } else { '' }
$min = ($visible | Measure-Object -Minimum).Minimum
$max = ($visible | Measure-Object -Maximum).Maximum
Write-Host "$mode, $Runs runs: window visible $min-$max ms$flSummary" -ForegroundColor Green
if ($BudgetMs -gt 0 -and $max -gt $BudgetMs) { throw "BUDGET FAILED: window visible at $max ms, budget $BudgetMs ms" }

<#
The four steps that were, until now, done by hand after every local change:
build the NSIS installer, stop the running DevGo, install it silently, bring
it back up. One command instead of four.

    bun run install:local                    build, install, relaunch
    bun run install:local -- --skip-build    reinstall the bundle already on disk
    bun run install:local -- --no-launch     do not relaunch DevGo afterward
    bun run install:local -- --dry-run       print the steps, touch nothing

    scripts\install-local.ps1                same, called directly

Windows only: it installs the NSIS bundle (an .exe) silently into DevGo's
own per-user location, $env:LOCALAPPDATA\DevGo. macOS ships a .dmg you drag
to Applications and Linux a .deb you `dpkg -i` - neither has a silent-install
equivalent worth scripting here; see README.md's Install section for both.
#>

$ErrorActionPreference = 'Stop'

$DryRun = $args -contains '--dry-run'
$SkipBuild = $args -contains '--skip-build'
$NoLaunch = $args -contains '--no-launch'
$known = @('--dry-run', '--skip-build', '--no-launch')
$unknown = $args | Where-Object { $known -notcontains $_ }
if ($unknown) { throw "install-local: unknown argument(s): $($unknown -join ', ') (known: $($known -join ', '))" }

function Step([string] $msg) {
	if ($DryRun) { Write-Host "[dry-run] $msg" -ForegroundColor DarkGray }
	else { Write-Host $msg }
}

# a repo-wide "which OS" test would need $IsWindows (PS 7+, absent on
# Windows PowerShell 5.1) with a fallback that works on both
$onWindows = if (Get-Variable -Name IsWindows -ErrorAction SilentlyContinue) { $IsWindows } else { $env:OS -eq 'Windows_NT' }
if (-not $onWindows) {
	throw "install-local.ps1 installs the Windows NSIS bundle only. On macOS: open the .dmg from Releases and drag DevGo.app to Applications. On Linux: sudo dpkg -i DevGo_<version>_amd64.deb. See README.md's Install section for both."
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$BundleDir = Join-Path $RepoRoot 'src-tauri\target\release\bundle\nsis'
$InstallDir = Join-Path $env:LOCALAPPDATA 'DevGo'
$InstalledExe = Join-Path $InstallDir 'DevGo.exe'

# --- 1. build -----------------------------------------------------------
if ($SkipBuild) {
	Step '1/4 skip build (--skip-build): reinstalling the bundle already on disk'
} else {
	# node_modules first: a pull can name a package this box never fetched,
	# and the build's `tsc` then fails on the missing import before cargo runs
	Step '1/4 bun install --frozen-lockfile'
	Step '1/4 bun run tauri build'
	if (-not $DryRun) {
		Push-Location $RepoRoot
		try {
			& bun install --frozen-lockfile
			$installExit = $LASTEXITCODE
			if ($installExit -eq 0) {
				& bun run tauri build
				$buildExit = $LASTEXITCODE
			}
		} finally {
			Pop-Location
		}
		if ($installExit -ne 0) { throw "bun install --frozen-lockfile failed (exit $installExit)" }
		if ($buildExit -ne 0) { throw "bun run tauri build failed (exit $buildExit)" }
	}
}

# --- locate the installer, by the version tauri.conf.json names --------
$confPath = Join-Path $RepoRoot 'src-tauri\tauri.conf.json'
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$version = $conf.version
if (-not $version) { throw "could not read a version from $confPath" }

$expected = Join-Path $BundleDir "DevGo_${version}_x64-setup.exe"
$installer = $null
if (Test-Path $expected) {
	$installer = Get-Item $expected
} elseif (Test-Path $BundleDir) {
	$installer = Get-ChildItem -Path $BundleDir -Filter '*-setup.exe' -ErrorAction SilentlyContinue |
		Sort-Object LastWriteTime -Descending | Select-Object -First 1
	if ($installer) {
		Write-Host "note: no installer for tauri.conf.json's version ($version); using the newest one found instead: $($installer.Name)" -ForegroundColor Yellow
	}
}
if (-not $installer) {
	if ($DryRun) {
		Step "2/4 installer: none on disk yet - expected $expected (or the newest *-setup.exe in $BundleDir)"
	} else {
		throw "no installer found in $BundleDir (looked for DevGo_${version}_x64-setup.exe, then any *-setup.exe)"
	}
} else {
	Step "2/4 installer: $($installer.FullName)"
}

# --- 2. stop the running DevGo, then install silently -------------------
Step '3/4 stop any running DevGo.exe, wait for it to exit, run the installer /S'
if (-not $DryRun) {
	$procs = Get-Process -Name DevGo -ErrorAction SilentlyContinue
	if ($procs) {
		Write-Host "stopping $($procs.Count) DevGo process(es)..."
		$procs | Stop-Process -Force -ErrorAction SilentlyContinue
		$deadline = (Get-Date).AddSeconds(15)
		while ((Get-Process -Name DevGo -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) {
			Start-Sleep -Milliseconds 200
		}
		if (Get-Process -Name DevGo -ErrorAction SilentlyContinue) {
			throw 'DevGo.exe is still running 15s after being asked to stop; close it and retry'
		}
	}

	if (-not $installer) { throw 'no installer to run (should have failed above already)' }
	$p = Start-Process -FilePath $installer.FullName -ArgumentList '/S' -Wait -PassThru
	if ($p.ExitCode -ne 0) { throw "installer exited $($p.ExitCode): $($installer.FullName)" }
}

# --- 3. relaunch ----------------------------------------------------------
if ($NoLaunch) {
	Step '4/4 skip relaunch (--no-launch)'
} else {
	Step "4/4 relaunch $InstalledExe"
	if (-not $DryRun) {
		if (-not (Test-Path $InstalledExe)) { throw "install reported success but $InstalledExe is missing" }
		Start-Process -FilePath $InstalledExe
	}
}

# --- report -----------------------------------------------------------------
if ($DryRun) {
	Write-Host ''
	Write-Host '[dry-run] nothing was built, installed, or launched.' -ForegroundColor DarkGray
} else {
	$exe = Get-Item $InstalledExe
	$sha = (& git -C $RepoRoot rev-parse --short HEAD).Trim()
	Write-Host ''
	Write-Host "installed: $($exe.FullName)" -ForegroundColor Green
	Write-Host "mtime:     $($exe.LastWriteTime)"
	Write-Host "built at:  $sha"
}

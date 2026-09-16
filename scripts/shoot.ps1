# Shoot the DevGo window as it is on screen: the real pixels, wallpaper
# through the see-through ground, nothing of the desktop in the frame.
#
#   scripts/shoot.ps1 -Out docs/screenshots/windows/01-four-lanes.png
#   scripts/shoot.ps1 -Out shot.png -Knob 20 -Wait 2
#
# Every other window is minimised and the desktop icons hidden, DevGo is
# brought up maximised, the client area is copied from the screen at native
# scale, then the icons and the windows come back. The window is found by
# its title, so it works on the installed build and on a dev build alike.
#
# -Knob writes window_transparency into prefs.json and puts the old bytes
# back after the shot. The app reads the knob when it starts, so set it
# before launching; with the app already up, step it in Settings ›
# Appearance instead. -Wait is the pause after the window is up, for the
# lanes to settle.

param(
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$Knob = -1,
  [double]$Wait = 1
)

# .NET keeps its own working directory; a relative path is meant from here
$Out = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Out)

Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public struct RECT { public int L, T, R, B; }
public struct POINT { public int X, Y; }
public class Win {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string t);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  // the desktop's icon view sits under Progman, or under a WorkerW when
  // a wallpaper slideshow has moved it
  public static IntPtr DefView() {
    IntPtr progman = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Progman", null);
    IntPtr dv = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (dv != IntPtr.Zero) return dv;
    IntPtr w = IntPtr.Zero;
    while ((w = FindWindowEx(IntPtr.Zero, w, "WorkerW", null)) != IntPtr.Zero) {
      dv = FindWindowEx(w, IntPtr.Zero, "SHELLDLL_DefView", null);
      if (dv != IntPtr.Zero) return dv;
    }
    return IntPtr.Zero;
  }
  public static IntPtr Icons() { var dv = DefView(); return dv == IntPtr.Zero ? IntPtr.Zero : FindWindowEx(dv, IntPtr.Zero, "SysListView32", null); }
}
"@

# the knob, before anything moves
$prefs = Join-Path $env:APPDATA 'app.zetta.devgo\prefs.json'
$prefsBefore = $null
if ($Knob -ge 0) {
  $prefsBefore = [System.IO.File]::ReadAllBytes($prefs)
  $json = [System.IO.File]::ReadAllText($prefs)
  $json = $json -replace '"window_transparency":\s*\d+', ('"window_transparency":' + $Knob)
  [System.IO.File]::WriteAllText($prefs, $json)
  Write-Host "knob $Knob written to prefs.json (read at the next launch)"
}

# the window, by title and process
$pids = @(Get-Process devgo -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$hwnd = [IntPtr]::Zero
[Win]::EnumWindows({ param($h, $l)
  $p = 0
  [void][Win]::GetWindowThreadProcessId($h, [ref]$p)
  if (($pids -contains $p) -and [Win]::Title($h) -eq 'DevGo' -and [Win]::IsWindowVisible($h)) { $script:hwnd = $h; return $false }
  $true }, [IntPtr]::Zero) | Out-Null
if ($hwnd -eq [IntPtr]::Zero) { Write-Error 'no DevGo window'; exit 1 }

$shell = New-Object -ComObject Shell.Application
$defView = [Win]::DefView()
$iconsWereVisible = [Win]::IsWindowVisible([Win]::Icons())
try {
  $shell.MinimizeAll()
  Start-Sleep -Milliseconds 700
  # WM_COMMAND 0x7402 is the desktop's own show/hide icons toggle
  if ($iconsWereVisible) { [void][Win]::SendMessage($defView, 0x0111, [IntPtr]0x7402, [IntPtr]::Zero) }
  [void][Win]::ShowWindow($hwnd, 3)   # SW_SHOWMAXIMIZED
  [void][Win]::SetForegroundWindow($hwnd)
  Start-Sleep -Seconds $Wait

  $r = New-Object RECT; [void][Win]::GetClientRect($hwnd, [ref]$r)
  $p = New-Object POINT; $p.X = 0; $p.Y = 0; [void][Win]::ClientToScreen($hwnd, [ref]$p)
  $w = $r.R - $r.L; $h = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($p.X, $p.Y, 0, 0, (New-Object System.Drawing.Size $w, $h))
  $g.Dispose()
  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("saved {0} {1}x{2} from {3},{4}" -f $Out, $w, $h, $p.X, $p.Y)
} finally {
  if ($iconsWereVisible) { [void][Win]::SendMessage($defView, 0x0111, [IntPtr]0x7402, [IntPtr]::Zero) }
  $shell.UndoMinimizeALL()
  Start-Sleep -Milliseconds 500
  [void][Win]::ShowWindow($hwnd, 3)
  [void][Win]::SetForegroundWindow($hwnd)
  if ($prefsBefore) { [System.IO.File]::WriteAllBytes($prefs, $prefsBefore); Write-Host 'prefs.json put back' }
}

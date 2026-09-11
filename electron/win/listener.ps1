# Windows notification listener for Floating Box.
# Runs under the built-in Windows PowerShell 5.1 (WinRT projection is not available in pwsh 7).
# Emits one JSON object per line on stdout:
#   {"type":"ready"} / {"type":"notification", ...} / {"type":"error","reason":"..."}
param([int]$PollSeconds = 2)

$ErrorActionPreference = 'Stop'
function Emit($obj) { Write-Output (ConvertTo-Json -Compress -Depth 4 $obj); [Console]::Out.Flush() }

try {
  [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.NotificationKinds, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
} catch {
  Emit @{ type = 'error'; reason = "WinRT unavailable: $($_.Exception.Message)" }
  exit 2
}

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}

try {
  $listener = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  $access = Await ($listener.RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus])
} catch {
  Emit @{ type = 'error'; reason = "listener unavailable: $($_.Exception.Message)" }
  exit 3
}
if ("$access" -ne 'Allowed') {
  Emit @{ type = 'error'; reason = "access $access (설정 > 개인 정보 및 보안 > 알림 에서 앱의 알림 액세스를 허용하세요)" }
  exit 4
}

Emit @{ type = 'ready' }
$seen = @{}
$first = $true
while ($true) {
  try {
    $notifs = Await ($listener.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
    $current = @{}
    foreach ($n in $notifs) {
      $current[$n.Id] = $true
      if ($seen.ContainsKey($n.Id)) { continue }
      $seen[$n.Id] = $true
      $app = ''
      try { $app = $n.AppInfo.DisplayInfo.DisplayName } catch {}
      $texts = @()
      try {
        $binding = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
        if ($binding) { foreach ($t in $binding.GetTextElements()) { $texts += $t.Text } }
      } catch {}
      $title = if ($texts.Count -gt 0) { $texts[0] } else { $app }
      $body = if ($texts.Count -gt 1) { ($texts[1..($texts.Count - 1)] -join "`n") } else { '' }
      Emit @{
        type = 'notification'; id = $n.Id; app = $app; title = $title; body = $body
        time = $n.CreationTime.ToUnixTimeMilliseconds(); existing = $first
      }
    }
    # forget ids that left the Action Center so a re-used id is not swallowed
    foreach ($k in @($seen.Keys)) { if (-not $current.ContainsKey($k)) { $seen.Remove($k) } }
    $first = $false
  } catch {
    Emit @{ type = 'error'; reason = "poll failed: $($_.Exception.Message)"; transient = $true }
  }
  Start-Sleep -Seconds $PollSeconds
}

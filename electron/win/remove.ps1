# Remove one notification from the Windows Action Center by id.
param([Parameter(Mandatory = $true)][uint32]$Id)
[Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.UI.Notifications.Management.UserNotificationListener]::Current.RemoveNotification($Id)

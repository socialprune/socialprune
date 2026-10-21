$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Path "$PSScriptRoot\window-readiness.cs"

function Wait-AppWindow {
  param(
    [int]$AppProcessId,
    [ValidateSet('ReviewAction', 'Navigation', 'ObserveAction', 'Close')][string]$Mode,
    [int]$TimeoutMs,
    [string]$Receipt,
    [scriptblock]$OnPoll,
    [string]$DesktopPath = $env:SP_PROOF_DESKTOP
  )
  if ($TimeoutMs -le 0 -or -not [IO.Path]::IsPathRooted($Receipt)) { throw 'WINDOW_READINESS_ARGUMENT_INVALID' }
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $iterations = 0
  $firstWindowMs = $null
  $firstKeepMs = $null
  $maximumWalkMs = 0
  $last = $null
  $state = 'observing'
  $branch = 'none'
  $errorId = $null
  $stationVisible = $null
  $desktop = $null
  $nativeFailure = $null
  $emptyEnumerations = 0
  $sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId)
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'SocialPrune')
  $condition = New-Object System.Windows.Automation.AndCondition($pidCondition, $nameCondition)
  $saveReceipt = {
    $selection = if ($desktop) { @{ source = $desktop.Source; requestedAccess = 65; probeDesktopMatches = $desktop.ProbeDesktopMatches } } else { $null }
    $value = [ordered]@{ version = 1; state = $state; mode = $Mode; branch = $branch; appProcessId = $AppProcessId; sessionId = $sessionId; windowStationVisible = $stationVisible; desktopSelection = $selection; nativeFailure = $nativeFailure; emptyEnumerations = $emptyEnumerations; timeoutMs = $TimeoutMs; elapsedMs = $clock.ElapsedMilliseconds; iterations = $iterations; firstWindowMs = $firstWindowMs; firstKeepMs = $firstKeepMs; maximumWalkMs = $maximumWalkMs; errorId = $errorId; last = $last }
    $text = $value | ConvertTo-Json -Depth 5 -Compress
    [IO.File]::WriteAllText($Receipt, $text, [Text.UTF8Encoding]::new($false))
    if ($state -ne 'observing') { [Console]::Error.WriteLine('WINDOW_READINESS_RECEIPT ' + $text) }
  }
  try {
    $stationVisible = [ReadinessWindows]::StationVisible()
    $desktop = [ReadinessWindows]::OpenOwned($AppProcessId, $DesktopPath)
    do {
      $iterations++
      $last = [ordered]@{ stage = 'window-lookup'; windowFound = $false; rootWindowFound = $null; nativeWindowCount = 0; windowProcessMatched = $null; windowNameMatched = $null; keepCount = 0; enabledKeepCount = 0; enabled = $null; focusAttempted = $false; focusResult = $null; focusError = $null; offscreen = $null; keyboardFocusable = $null; invokeAvailable = $null; navigationFound = $false; walkMs = $null }
      & $saveReceipt
      if ($OnPoll) { $null = & $OnPoll }
      # Root lookup is diagnostic only. Its absence is not app-window absence.
      $last.rootWindowFound = $null -ne [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
      $handles = @($desktop.FindOwned($AppProcessId))
      $last.nativeCall = 'EnumDesktopWindows'
      $last.nativeReturned = $desktop.EnumerationReturned
      $last.win32Error = $desktop.EnumerationError
      $last.enumeratedWindows = $desktop.Callbacks
      if (-not $desktop.EnumerationReturned -and $desktop.EnumerationError -eq 0 -and $desktop.Callbacks -eq 0) { $emptyEnumerations++ }
      $last.nativeWindowCount = $handles.Count
      foreach ($handle in $handles) {
        $candidate = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        $last.windowProcessMatched = $candidate.Current.ProcessId -eq $AppProcessId
        $last.windowNameMatched = $candidate.Current.Name -eq 'SocialPrune'
        if (-not $last.windowProcessMatched -or -not $last.windowNameMatched) { continue }
        $last.windowFound = $true
        if ($null -eq $firstWindowMs) { $firstWindowMs = $clock.ElapsedMilliseconds }
        if ($Mode -eq 'Close') {
          $state = 'ready'; $branch = 'owned-window-close'
          return @{ window = $candidate; interactiveAt = $null; branch = $branch }
        }
        $last.stage = 'controls-lookup'
        & $saveReceipt
        $walk = [Diagnostics.Stopwatch]::StartNew()
        $nodes = $candidate.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        $walk.Stop()
        $last.walkMs = $walk.ElapsedMilliseconds
        $maximumWalkMs = [Math]::Max($maximumWalkMs, $walk.ElapsedMilliseconds)
        $keep = @($nodes | Where-Object { $_.Current.Name -match '^Keep(\s|$)' -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
        $last.keepCount = $keep.Count
        $enabledKeep = @($keep | Where-Object { $_.Current.IsEnabled })
        $last.enabledKeepCount = $enabledKeep.Count
        if ($keep.Count) {
          if ($null -eq $firstKeepMs) { $firstKeepMs = $clock.ElapsedMilliseconds }
          $action = if ($enabledKeep.Count) { $enabledKeep[0] } else { $keep[0] }
          $last.enabled = $action.Current.IsEnabled
          $last.offscreen = $action.Current.IsOffscreen
          $last.keyboardFocusable = $action.Current.IsKeyboardFocusable
          $pattern = $null
          $last.invokeAvailable = $action.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)
          if ($Mode -eq 'ReviewAction' -and $last.enabled) {
            $last.stage = 'focus-readback'
            $last.focusAttempted = $true
            & $saveReceipt
            try { $action.SetFocus(); $last.focusResult = $action.Current.HasKeyboardFocus }
            catch [System.InvalidOperationException] { $last.focusResult = $false; $last.focusError = 'InvalidOperationException' }
          } else { $last.focusResult = $action.Current.HasKeyboardFocus }
          if ($last.enabled -and $Mode -eq 'ObserveAction') {
            $state = 'ready'; $branch = 'observe-action'
            return @{ window = $candidate; action = $action; interactiveAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); branch = $branch }
          }
          # HWND discovery fixes the demonstrated station mismatch. Focus and
          # on-screen readback remain mandatory; capability alone is not a pass.
          if ($Mode -eq 'ReviewAction' -and $last.enabled -and $last.focusResult -and -not $last.offscreen) {
            $state = 'ready'; $branch = 'focus-readback'
            return @{ window = $candidate; interactiveAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); branch = $branch }
          }
        }
        if ($Mode -eq 'Navigation') {
          $names = @($nodes | ForEach-Object { $_.Current.Name })
          $last.navigationFound = $names -contains 'Review' -and $names -contains 'Data and backups'
          if ($last.navigationFound) {
            $state = 'ready'; $branch = 'navigation-readback'
            return @{ window = $candidate; interactiveAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); branch = $branch }
          }
        }
      }
      $last.stage = 'poll-interval'
      & $saveReceipt
      Start-Sleep -Milliseconds 50
    } while ($clock.ElapsedMilliseconds -lt $TimeoutMs)
    throw 'WINDOW_READINESS_MISSING'
  } catch {
    $state = 'failed'
    $cause = $_.Exception
    while ($cause.InnerException) { $cause = $cause.InnerException }
    if ($cause -is [ReadinessWindows+NativeFailure]) {
      $nativeFailure = @{ call = $cause.Call; win32Error = $cause.NativeErrorCode }
      $errorId = 'READINESS_NATIVE_FAILED:' + $cause.Call + ':' + $cause.NativeErrorCode
      throw $errorId
    }
    if ($_.Exception.Message -eq 'WINDOW_READINESS_MISSING') {
      $errorId = switch ($Mode) { 'ReviewAction' { 'RELEASE_INTERACTIVE_FRAME_MISSING' } 'Navigation' { 'SMOKE_INTERACTIVE_WINDOW_MISSING' } 'ObserveAction' { 'INACTIVE_RELEASE_ACTION_MISSING' } 'Close' { 'RELEASE_CLOSE_WINDOW_MISSING' } }
      throw $errorId
    }
    $errorId = if ($_.Exception.Message -match 'WINDOW_READINESS_[A-Z_]+') { $Matches[0] } else { $_.Exception.GetType().Name }
    throw
  } finally {
    try { if ($desktop) { $desktop.Dispose() } }
    catch {
      $cause = $_.Exception
      while ($cause.InnerException) { $cause = $cause.InnerException }
      $state = 'failed'
      if ($cause -is [ReadinessWindows+NativeFailure]) {
        $nativeFailure = @{ call = $cause.Call; win32Error = $cause.NativeErrorCode }
        $errorId = 'READINESS_NATIVE_FAILED:' + $cause.Call + ':' + $cause.NativeErrorCode
      } else { $errorId = $cause.GetType().Name }
      throw
    } finally { & $saveReceipt }
  }
}

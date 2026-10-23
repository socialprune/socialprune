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
  $firstActionMs = $null
  $maximumWalkMs = 0
  $last = $null
  $state = 'observing'
  $branch = 'none'
  $errorId = $null
  $stationVisible = $null
  $desktop = $null
  $nativeFailure = $null
  $emptyEnumerations = 0
  $appWatch = $null
  $appObservation = $null
  $maximumEnumeratedWindows = 0
  $firstOwnedWindowMs = $null
  $nextAppObservationMs = 0
  $firstAppObservation = $null
  $sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  $pidCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $AppProcessId)
  $nameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'SocialPrune')
  $condition = New-Object System.Windows.Automation.AndCondition($pidCondition, $nameCondition)
  $saveReceipt = {
    $selection = if ($desktop) { @{ source = $desktop.Source; requestedAccess = 65; probeDesktopMatches = $desktop.ProbeDesktopMatches } } else { $null }
    $value = [ordered]@{ version = 1; state = $state; mode = $Mode; branch = $branch; appProcessId = $AppProcessId; sessionId = $sessionId; windowStationVisible = $stationVisible; desktopSelection = $selection; nativeFailure = $nativeFailure; firstAppObservation = $firstAppObservation; appObservation = $appObservation; maximumEnumeratedWindows = $maximumEnumeratedWindows; firstOwnedWindowMs = $firstOwnedWindowMs; emptyEnumerations = $emptyEnumerations; timeoutMs = $TimeoutMs; elapsedMs = $clock.ElapsedMilliseconds; iterations = $iterations; firstWindowMs = $firstWindowMs; firstActionMs = $firstActionMs; maximumWalkMs = $maximumWalkMs; errorId = $errorId; last = $last }
    $text = $value | ConvertTo-Json -Depth 9 -Compress
    [IO.File]::WriteAllText($Receipt, $text, [Text.UTF8Encoding]::new($false))
    if ($state -ne 'observing') { [Console]::Error.WriteLine('WINDOW_READINESS_RECEIPT ' + $text) }
  }
  try {
    $stationVisible = [ReadinessWindows]::StationVisible()
    $appWatch = [ReadinessWindows]::WatchApp($AppProcessId, $DesktopPath)
    $appObservation = $appWatch.ObserveApp()
    $firstAppObservation = $appObservation
    $desktop = [ReadinessWindows]::OpenOwned($AppProcessId, $DesktopPath)
    do {
      $iterations++
      $last = [ordered]@{ stage = 'window-lookup'; windowFound = $false; rootWindowFound = $null; nativeWindowCount = 0; windowProcessMatched = $null; windowNameMatched = $null; actionKind = 'review-criteria'; actionCount = 0; enabledActionCount = 0; enabled = $null; focusAttempted = $false; focusResult = $null; focusError = $null; offscreen = $null; keyboardFocusable = $null; invokeAvailable = $null; navigationFound = $false; walkMs = $null }
      & $saveReceipt
      if ($OnPoll) { $null = & $OnPoll }
      if ($clock.ElapsedMilliseconds -ge $nextAppObservationMs) {
        $appObservation = $appWatch.ObserveApp()
        $nextAppObservationMs = $clock.ElapsedMilliseconds + 1000
      }
      if (-not $appObservation.alive) { throw 'REVIEW_APP_EXITED_BEFORE_READY' }
      # Root lookup is diagnostic only. Its absence is not app-window absence.
      $last.rootWindowFound = $null -ne [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)
      $handles = @($desktop.FindOwned($AppProcessId))
      $last.nativeCall = 'EnumDesktopWindows'
      $last.nativeReturned = $desktop.EnumerationReturned
      $last.win32Error = $desktop.EnumerationError
      $last.enumeratedWindows = $desktop.Callbacks
      $maximumEnumeratedWindows = [Math]::Max($maximumEnumeratedWindows, $desktop.Callbacks)
      if (-not $desktop.EnumerationReturned -and $desktop.EnumerationError -eq 0 -and $desktop.Callbacks -eq 0) { $emptyEnumerations++ }
      $last.nativeWindowCount = $handles.Count
      if ($handles.Count -and $null -eq $firstOwnedWindowMs) { $firstOwnedWindowMs = $clock.ElapsedMilliseconds }
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
        # The criteria button exists on the empty first start and becomes
        # Change when criteria are selected. Unlike the options menu trigger,
        # these ordinary buttons expose InvokePattern on the shipped renderer.
        # Focus proves an interactive frame without invoking a decision or menu.
        # WinPS 5.1 reads a BOM-less script in its legacy code page. Construct
        # the two German labels as Unicode so the shipped UI names match there.
        $actionNames = @('Choose criteria', ('Kriterien w' + [char]0x00E4 + 'hlen'), 'Change', ([string][char]0x00C4 + 'ndern'))
        $actions = @($nodes | Where-Object { $_.Current.Name -in $actionNames -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button })
        $last.actionCount = $actions.Count
        $enabledActions = @($actions | Where-Object { $_.Current.IsEnabled })
        $last.enabledActionCount = $enabledActions.Count
        if ($actions.Count) {
          if ($null -eq $firstActionMs) { $firstActionMs = $clock.ElapsedMilliseconds }
          $action = if ($enabledActions.Count) { $enabledActions[0] } else { $actions[0] }
          $last.enabled = $action.Current.IsEnabled
          $last.offscreen = $action.Current.IsOffscreen
          $bounds = $action.Current.BoundingRectangle
          $last.boundingRectangle = @{ left = $bounds.Left; top = $bounds.Top; width = $bounds.Width; height = $bounds.Height; empty = $bounds.IsEmpty }
          $last.onScreenBranch = 'uia-not-offscreen-required'
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
          if ($last.enabled -and $last.invokeAvailable -and $last.keyboardFocusable -and $Mode -eq 'ObserveAction') {
            $state = 'ready'; $branch = 'observe-action'
            return @{ window = $candidate; action = $action; interactiveAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); branch = $branch }
          }
          # HWND discovery fixes the demonstrated station mismatch. Focus and
          # on-screen readback remain mandatory; capability alone is not a pass.
          if ($Mode -eq 'ReviewAction' -and $last.enabled -and $last.focusResult -and -not $last.offscreen -and $last.invokeAvailable -and $last.keyboardFocusable) {
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
    if ($appWatch) { try { $appObservation = $appWatch.ObserveApp() } catch { $nativeFailure = @{ call = 'ObserveApp'; win32Error = $null } } }
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
    try {
      # The periodic diagnostic sample can predate the HWND that just passed
      # readiness. Refresh that same native handle before publishing success;
      # keep the original deadline and every action/focus/visibility predicate.
      try {
        if ($state -eq 'ready') {
          do {
            $appObservation = $appWatch.ObserveApp()
            if (-not $appObservation.alive) { throw 'REVIEW_APP_EXITED_BEFORE_READY' }
            $observedHandle = @($appObservation.windows | Where-Object { $_.hwnd -eq $handle.ToInt64() })
            if ($observedHandle.Count) { break }
            if ($clock.ElapsedMilliseconds -ge $TimeoutMs) { throw 'WINDOW_READINESS_OBSERVATION_MISSING' }
            Start-Sleep -Milliseconds 25
          } while ($true)
        }
      } finally { if ($desktop) { $desktop.Dispose() } }
    }
    catch {
      $cause = $_.Exception
      while ($cause.InnerException) { $cause = $cause.InnerException }
      $state = 'failed'
      if ($cause -is [ReadinessWindows+NativeFailure]) {
        $nativeFailure = @{ call = $cause.Call; win32Error = $cause.NativeErrorCode }
        $errorId = 'READINESS_NATIVE_FAILED:' + $cause.Call + ':' + $cause.NativeErrorCode
      } else { $errorId = $cause.GetType().Name }
      throw
    } finally { & $saveReceipt; if ($appWatch) { $appWatch.Dispose() } }
  }
}

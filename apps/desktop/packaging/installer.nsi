# -*- coding: utf-8 -*-
Unicode true
RequestExecutionLevel user
SetCompressor zlib
SetDatablockOptimize on
Name "SocialPrune"
OutFile "${OUTPUT}"
InstallDir "$LOCALAPPDATA\Programs\SocialPrune"
ShowInstDetails show
ShowUninstDetails show
AutoCloseWindow true
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles
!include "LogicLib.nsh"
!include "WinMessages.nsh"
!include "FileFunc.nsh"
!insertmacro GetParent
LoadLanguageFile "${NSISDIR}\Contrib\Language files\English.nlf"
LoadLanguageFile "${NSISDIR}\Contrib\Language files\German.nlf"
; The builder checks the pinned PE32/x86 stub before compiling this layout.
!define PROCESSENTRY32W_SIZE 556
!define PROCESSENTRY32W_NAME_OFFSET 36
LangString Running ${LANG_ENGLISH} "Close SocialPrune before installing or uninstalling."
LangString Running ${LANG_GERMAN} "Schließe SocialPrune vor dem Installieren oder Deinstallieren."
LangString Root ${LANG_ENGLISH} "This works only from %LOCALAPPDATA%\Programs\SocialPrune; nothing was changed."
LangString Root ${LANG_GERMAN} "Dies funktioniert nur unter %LOCALAPPDATA%\Programs\SocialPrune; nichts wurde geändert."
LangString Link ${LANG_ENGLISH} "A folder on the install path is a link; nothing was changed."
LangString Link ${LANG_GERMAN} "Ein Ordner im Installationspfad ist ein Link; nichts wurde geändert."
LangString Elevated ${LANG_ENGLISH} "Run this without administrator rights; nothing was changed."
LangString Elevated ${LANG_GERMAN} "Starte dies ohne Administratorrechte; nichts wurde geändert."
LangString PathRead ${LANG_ENGLISH} "The install path could not be checked; nothing was changed."
LangString PathRead ${LANG_GERMAN} "Der Installationspfad konnte nicht geprüft werden; nichts wurde geändert."
LangString Partial ${LANG_ENGLISH} "These files could not be removed: $FailedFiles; SocialPrune stays listed in Apps."
LangString Partial ${LANG_GERMAN} "Diese Dateien konnten nicht entfernt werden: $FailedFiles; SocialPrune bleibt unter Apps aufgeführt."

Var CheckInput
Var CheckResult
Var ScanPath
Var AppRunning
Var InitError
Var FailedFiles
Var RemovalFailed

!macro Checks Prefix
Function ${Prefix}CheckPath
  StrCpy $CheckResult 0
  StrCpy $ScanPath $CheckInput
  checkNext:
  System::Call 'kernel32::GetFileAttributesW(w "$ScanPath") i .r4 ?e'
  Pop $5
  IntCmp $4 -1 pathReadFailure
  IntOp $4 $4 & 0x400
  IntCmp $4 0 pathParent
  StrCpy $CheckResult 1
  Return
  pathReadFailure:
  ; ?e captures GetLastError before another plugin call can replace it.
  IntCmp $5 2 pathParent
  IntCmp $5 3 pathParent
  StrCpy $CheckResult 2
  Return
  pathParent:
  StrLen $4 $ScanPath
  IntCmp $4 3 pathDone pathDone
  ${GetParent} "$ScanPath" $ScanPath
  StrCmp $ScanPath "" pathDone checkNext
  pathDone:
FunctionEnd

Function ${Prefix}CheckRunning
  StrCpy $AppRunning 0
  System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) p .r0'
  ; Ask Windows about validity instead of comparing a formatted pointer to -1.
  System::Call 'kernel32::GetHandleInformation(p r0, *i .r4) i .r2'
  IntCmp $2 0 processFailure
  System::Alloc ${PROCESSENTRY32W_SIZE}
  Pop $1
  StrCmp $1 0 processFailureClose
  System::Call '*$1(i ${PROCESSENTRY32W_SIZE})'
  System::Call 'kernel32::Process32FirstW(p r0, p r1) i .r2'
  IntCmp $2 0 processFailureFree
  processLoop:
  IntCmp $2 0 processDone
   IntOp $6 $1 + ${PROCESSENTRY32W_NAME_OFFSET}
   System::Call '*$6(&w260 .r3)'
  StrCmp $3 "SocialPrune.exe" processFound
  System::Call 'kernel32::Process32NextW(p r0, p r1) i .r2 ?e'
  Pop $5
  IntCmp $2 0 0 processLoop processLoop
  IntCmp $5 18 processDone processFailureFree processFailureFree
  Goto processLoop
  processFound:
  StrCpy $AppRunning 1
  processDone:
  System::Free $1
  System::Call 'kernel32::CloseHandle(p r0)'
  Return
  processFailureFree:
  System::Free $1
  processFailureClose:
  System::Call 'kernel32::CloseHandle(p r0)'
  processFailure:
  ; Failure to inspect processes refuses the operation, never ends an app.
  StrCpy $AppRunning 1
FunctionEnd
!macroend
!insertmacro Checks ""
!insertmacro Checks "un."

!macro Init Prefix RunningCode RootCode
  SetShellVarContext current
  SetRegView 64
  System::Call 'kernel32::GetUserDefaultUILanguage() i .r4'
  IntOp $4 $4 & 0x3ff
  StrCpy $LANGUAGE ${LANG_ENGLISH}
  IntCmp $4 7 0 languageDone languageDone
  StrCpy $LANGUAGE ${LANG_GERMAN}
  languageDone:
  System::Call 'shell32::IsUserAnAdmin() i .r4'
  IntCmp $4 0 +4
  StrCpy $InitError "ELEVATED_REFUSED"
  MessageBox MB_OK|MB_ICONSTOP "$InitError: $(Elevated)" /SD IDOK
  Goto refusedExit
  ; Neither /D nor _?= nor a moved uninstaller can redirect deletion.
  StrCmp $INSTDIR "$LOCALAPPDATA\Programs\SocialPrune" rootAccepted
  StrCpy $InitError "${RootCode}"
  MessageBox MB_OK|MB_ICONSTOP "$InitError: $(Root)" /SD IDOK
  Goto refusedExit
  rootAccepted:
  StrCpy $INSTDIR "$LOCALAPPDATA\Programs\SocialPrune"
  Call ${Prefix}CheckRunning
  StrCmp $AppRunning 0 runningAccepted
  StrCpy $InitError "${RunningCode}"
  MessageBox MB_OK|MB_ICONSTOP "$InitError: $(Running)" /SD IDOK
  Goto refusedExit
  runningAccepted:
  StrCpy $CheckInput $INSTDIR
  Call ${Prefix}CheckPath
  StrCmp $CheckResult 0 initDone
  StrCmp $CheckResult 2 0 +4
  StrCpy $InitError "PATH_READ_REFUSED"
  MessageBox MB_OK|MB_ICONSTOP "$InitError: $(PathRead)" /SD IDOK
  Goto refusedExit
  StrCpy $InitError "INSTALL_LINK_REFUSED"
  MessageBox MB_OK|MB_ICONSTOP "$InitError: $(Link)" /SD IDOK
  refusedExit:
  SetErrorLevel 10
  Quit
  initDone:
!macroend
Function .onInit
  !insertmacro Init "" "INSTALL_APP_RUNNING" "INSTALL_ROOT_REFUSED"
FunctionEnd
Function un.onInit
  !insertmacro Init "un." "UNINSTALL_APP_RUNNING" "UNINSTALL_ROOT_REFUSED"
FunctionEnd

!macro VerifyPath Relative
  !define /redef VERIFY_LABEL ${__LINE__}
  StrCpy $CheckInput "$INSTDIR\${Relative}"
  Call CheckPath
  StrCmp $CheckResult 0 verifyDone${VERIFY_LABEL}
  StrCmp $CheckResult 2 0 +3
  MessageBox MB_OK|MB_ICONSTOP "PATH_READ_REFUSED: $(PathRead)" /SD IDOK
  Goto verifyExit${VERIFY_LABEL}
  MessageBox MB_OK|MB_ICONSTOP "INSTALL_LINK_REFUSED: $(Link)" /SD IDOK
  verifyExit${VERIFY_LABEL}:
  SetErrorLevel 11
  Quit
  verifyDone${VERIFY_LABEL}:
!macroend
!macro InstallFile Relative
  ${GetParent} "$INSTDIR\${Relative}" $0
  SetOutPath "$0"
  File "${INPUT}\${Relative}"
!macroend

!macro DeleteListed Prefix Relative
  !define /redef DELETE_LABEL ${__LINE__}
  StrCpy $CheckInput "$INSTDIR\${Relative}"
  Call ${Prefix}CheckPath
  StrCmp $CheckResult 1 deleteDone${DELETE_LABEL}
  StrCmp $CheckResult 2 deleteFailed${DELETE_LABEL}
  ClearErrors
  Delete "$INSTDIR\${Relative}"
  IfErrors deleteFailed${DELETE_LABEL} deleteDone${DELETE_LABEL}
  deleteFailed${DELETE_LABEL}:
  StrCpy $RemovalFailed 1
  StrCpy $FailedFiles "$FailedFiles ${Relative}"
  deleteDone${DELETE_LABEL}:
  StrCmp $RemovalFailed 0 +2
  SetErrors
!macroend

Section "Install"
  Call CheckRunning
  StrCmp $AppRunning 0 +4
  MessageBox MB_OK|MB_ICONSTOP "INSTALL_APP_RUNNING: $(Running)" /SD IDOK
  SetErrorLevel 10
  Quit
  ; Check the full target list before changing the first byte.
  StrCpy $CheckInput "$SMPROGRAMS\SocialPrune.lnk"
  Call CheckPath
  StrCmp $CheckResult 0 shortcutAccepted
  StrCmp $CheckResult 2 0 shortcutLink
  MessageBox MB_OK|MB_ICONSTOP "PATH_READ_REFUSED: $(PathRead)" /SD IDOK
  Goto shortcutExit
  shortcutLink:
  MessageBox MB_OK|MB_ICONSTOP "INSTALL_LINK_REFUSED: $(Link)" /SD IDOK
  shortcutExit:
  SetErrorLevel 11
  Quit
  shortcutAccepted:
  !include "${VERIFY_LIST}"
  !insertmacro VerifyPath "Uninstall.exe"
  !insertmacro VerifyPath "installed-files.json"
  StrCpy $RemovalFailed 0
  StrCpy $FailedFiles ""
  ClearErrors
  !include "${OBSOLETE_LIST}"
  IfErrors installPartial
  !include "${INSTALL_LIST}"
  SetOutPath "$INSTDIR"
  File "${MANIFEST}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateShortcut "$SMPROGRAMS\SocialPrune.lnk" "$INSTDIR\SocialPrune.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune" "DisplayName" "SocialPrune"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune" "UninstallString" '$\"$INSTDIR\Uninstall.exe$\"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune" "QuietUninstallString" '$\"$INSTDIR\Uninstall.exe$\" /S'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune" "NoRepair" 1
  Goto installDone
  installPartial:
  MessageBox MB_OK|MB_ICONSTOP "PARTIAL_REMOVAL: $(Partial)" /SD IDOK
  SetErrorLevel 12
  Quit
  installDone:
SectionEnd

Section "Uninstall"
  Call un.CheckRunning
  StrCmp $AppRunning 0 +4
  MessageBox MB_OK|MB_ICONSTOP "UNINSTALL_APP_RUNNING: $(Running)" /SD IDOK
  SetErrorLevel 10
  Quit
  ; This list is compiled into the uninstaller, not read from mutable disk.
  StrCpy $RemovalFailed 0
  StrCpy $FailedFiles ""
  ClearErrors
  !include "${UNINSTALL_LIST}"
  IfErrors uninstallPartial
  StrCpy $CheckInput "$SMPROGRAMS\SocialPrune.lnk"
  Call un.CheckPath
  StrCmp $CheckResult 0 +2
  Goto keepShortcut
  Delete "$SMPROGRAMS\SocialPrune.lnk"
  keepShortcut:
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SocialPrune"
  Goto uninstallDone
  uninstallPartial:
  MessageBox MB_OK|MB_ICONSTOP "PARTIAL_UNINSTALL: $(Partial)" /SD IDOK
  SetErrorLevel 12
  Quit
  uninstallDone:
SectionEnd

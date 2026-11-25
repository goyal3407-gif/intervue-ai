; Intervue AI — NSIS Setup script (v1.3.1)
; Per-user install (admin nahi chahiye). User data (%APPDATA%) kabhi nahi hataya jata,
; taaki keys / profile / settings har update par bane rahen.
Unicode true
!include "MUI2.nsh"

Name "Intervue AI"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Intervue AI"
InstallDirRegKey HKCU "Software\SecureCoursePlayer" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
SetCompressorDictSize 32
BrandingText "Intervue AI v1.3.1 — Setup"
VIProductVersion "1.3.1.0"
VIAddVersionKey "ProductName" "Intervue AI"
VIAddVersionKey "FileDescription" "Intervue AI Setup"
VIAddVersionKey "FileVersion" "1.3.1.0"
VIAddVersionKey "ProductVersion" "1.3.1"

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "Intervue AI tumhare PC par install hoga.$\r$\n$\r$\nDesktop aur Start Menu me shortcut ban jayega. Kabhi hatana ho to Windows Settings > Apps se uninstall kar sakte ho.$\r$\n$\r$\nNote: agar app abhi chal raha hai, to setup use band karke aage badhega (tumhari keys aur settings surakshit rahengi)."

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\Intervue AI.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Intervue AI chalao"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  DetailPrint "Chal raha app band kiya ja raha hai (files lock na hon)..."
  nsExec::ExecToLog 'taskkill /IM "Intervue AI.exe" /F'
  Sleep 800
  File /r "${SRCDIR}/*.*"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Intervue AI"
  CreateShortcut "$SMPROGRAMS\Intervue AI\Intervue AI.lnk" "$INSTDIR\Intervue AI.exe" "" "$INSTDIR\Intervue AI.exe" 0
  CreateShortcut "$SMPROGRAMS\Intervue AI\Uninstall.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0
  CreateShortcut "$DESKTOP\Intervue AI.lnk" "$INSTDIR\Intervue AI.exe" "" "$INSTDIR\Intervue AI.exe" 0
  WriteRegStr HKCU "Software\SecureCoursePlayer" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "DisplayName" "Intervue AI"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "DisplayVersion" "1.3.1"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "Publisher" "Goyal"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "DisplayIcon" "$INSTDIR\Intervue AI.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer" "EstimatedSize" 332800
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog 'taskkill /IM "Intervue AI.exe" /F'
  Sleep 800
  Delete "$DESKTOP\Intervue AI.lnk"
  RMDir /r "$SMPROGRAMS\Intervue AI"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\SecureCoursePlayer"
  DeleteRegKey HKCU "Software\SecureCoursePlayer"
  RMDir /r "$INSTDIR"
  ; Note: %APPDATA% wala user data (API keys, profile, settings) jaan-bujh kar nahi hataya —
  ; dobara install karne par sab kuch waisa ka waisa mil jayega.
SectionEnd

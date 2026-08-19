; FrameWorkshop ERP — Windows installer (NSIS).
; Copies a zip of the app (so Next.js folders like src/app/(app) survive)
; then runs first-time setup.

Unicode true
SetCompressor /SOLID lzma
CRCCheck on
RequestExecutionLevel user

!define NAME "FrameWorkshop ERP"
!define PUBLISHER "FrameWorkshop"
!define VERSION "0.1.0"
!define URL "https://github.com/chobsaaron-glitch/cursor"

OutFile "FrameWorkshop-Setup.exe"
InstallDir "$LOCALAPPDATA\FrameWorkshop"
InstallDirRegKey HKCU "Software\FrameWorkshop" "InstallDir"
Name "${NAME}"
BrandingText "${NAME} ${VERSION}"

Page directory
Page instfiles

Section "Install"
  SetOutPath "$INSTDIR"
  File "payload.zip"

  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath ''$INSTDIR\payload.zip'' -DestinationPath ''$INSTDIR'' -Force"'
  Delete "$INSTDIR\payload.zip"

  WriteRegStr HKCU "Software\FrameWorkshop" "InstallDir" "$INSTDIR"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameWorkshop" "DisplayName" "${NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameWorkshop" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameWorkshop" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameWorkshop" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameWorkshop" "HelpLink" "${URL}"

  CreateDirectory "$SMPROGRAMS\FrameWorkshop"
  CreateShortCut "$SMPROGRAMS\FrameWorkshop\FrameWorkshop.lnk" "$INSTDIR\scripts\windows\start.bat" "" "" 0 SW_SHOWNORMAL
  CreateShortCut "$DESKTOP\FrameWorkshop.lnk" "$INSTDIR\scripts\windows\start.bat" "" "" 0 SW_SHOWNORMAL
  CreateShortCut "$SMPROGRAMS\FrameWorkshop\Удалить FrameWorkshop.lnk" "$INSTDIR\Uninstall.exe"

  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\windows\install.ps1"'
SectionEnd

Section "Uninstall"
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\scripts\windows\stop.ps1"'
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\FrameWorkshop.lnk"
  RMDir /r "$SMPROGRAMS\FrameWorkshop"
  DeleteRegKey HKCU "Software\FrameWorkshop"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\FrameWorkshop"
SectionEnd

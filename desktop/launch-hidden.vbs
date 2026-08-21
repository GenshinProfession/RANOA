Option Explicit

Dim fileSystem, shell, projectRoot, escapedRoot, command

Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

projectRoot = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
escapedRoot = Replace(projectRoot, "'", "''")
command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command " _
  & Chr(34) & "Set-Location -LiteralPath '" & escapedRoot & "'; npm.cmd run desktop:dev" & Chr(34)

shell.Run command, 0, False

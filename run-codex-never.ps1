param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodexArgs
)

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[Codex] Project: $projectDir"
Write-Host "[Codex] Mode: approval=never, sandbox=workspace-write"

codex -C "$projectDir" -a never -s workspace-write @CodexArgs

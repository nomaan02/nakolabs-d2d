<#
.SYNOPSIS
  Builds .handoff/review/<id>.md: one file holding everything Claude needs
  to review a session (gates, Grok's report, changed files, filtered diff,
  check output tails). Read-only: never changes git state.

.EXAMPLE
  # after a queue-runner session (the runner calls this for you)
  .\scripts\agent\review-pack.ps1 -Id ui-5-a2 -Commit 1a2b3c4

  # after a manual Cursor IDE session (uncommitted working tree)
  .\scripts\agent\review-pack.ps1 -Id ui-6-b1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Id,
  [string]$Commit = '',
  [int]$MaxDiffLines = 2500,
  [int]$MaxNewFileLines = 300
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'lib.ps1')

if ($Id -notmatch '^[a-z0-9][a-z0-9.-]*$') { Write-Host 'Id must look like ui-5-a2'; exit 1 }
if ($Commit -and $Commit -notmatch '^[0-9a-fA-F]{4,40}$') { Write-Host 'Commit must be a hex sha'; exit 1 }
try { Set-RepoRoot } catch { Write-Host $_.Exception.Message; exit 1 }

$Handoff = Join-Path $script:RepoRoot '.handoff'
$logs = Join-Path $Handoff 'logs'
$outPath = Join-Path (Join-Path $Handoff 'review') ($Id + '.md')

$excludes = ($script:DiffExcludes | ForEach-Object { '":(exclude)' + $_ + '"' }) -join ' '
$fence = '~~~~'

$o = @()
$o += ('# Review pack: ' + $Id)
$o += ''
$o += ('Generated ' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + ' on branch `' + (Get-CurrentBranch) + '`')
if ($Commit) { $o += ('Checkpoint commit: `' + $Commit + '`') } else { $o += 'Source: working tree (uncommitted)' }
$o += ''

$o += '## Runner gates'
$gates = Read-Utf8 -Path (Join-Path $logs ($Id + '.gates.md'))
if ($gates) { $o += $gates.TrimEnd() } else { $o += 'No runner gate file (manual session, or not run by the runner).' }
$o += ''

$o += '## Grok report'
$report = Read-Utf8 -Path (Join-Path (Join-Path $Handoff 'reports') ($Id + '.md'))
if ($report) { $o += $report.TrimEnd() } else { $o += '(missing: no .handoff/reports/' + $Id + '.md)' }
$o += ''

$o += '## Files changed'
$o += $fence
if ($Commit) {
  $o += (Invoke-Git ('show --stat --format= ' + $Commit)).Output.TrimEnd()
} else {
  $o += (Invoke-Git 'status --short --untracked-files=all').Output.TrimEnd()
}
$o += $fence
$o += ''

$o += ('## Diff (filtered: ' + ($script:DiffExcludes -join ', ') + ')')
if ($Commit) {
  $diff = (Invoke-Git ('show --format= --patch ' + $Commit + ' -- . ' + $excludes)).Output
} else {
  $diff = (Invoke-Git ('diff HEAD -- . ' + $excludes)).Output
}
$diffLines = $diff -split "`r?`n"
$o += ($fence + 'diff')
if ($diffLines.Count -gt $MaxDiffLines) {
  $o += ($diffLines[0..($MaxDiffLines - 1)] -join "`n")
  $o += $fence
  $o += ('(diff cut at ' + $MaxDiffLines + ' of ' + $diffLines.Count + ' lines)')
} else {
  $o += $diff.TrimEnd()
  $o += $fence
}
$o += ''

if (-not $Commit) {
  $untracked = @(((Invoke-Git 'ls-files --others --exclude-standard').Output -split "`r?`n") | Where-Object { $_ })
  if ($untracked.Count -gt 0) {
    $o += '## New untracked files'
    foreach ($u in $untracked) {
      $full = Join-Path $script:RepoRoot $u
      $o += ('### ' + $u)
      $text = Read-Utf8 -Path $full
      if ($null -eq $text) { $o += '(could not read)'; continue }
      $lines = $text -split "`r?`n"
      $o += $fence
      if ($lines.Count -gt $MaxNewFileLines) {
        $o += ($lines[0..($MaxNewFileLines - 1)] -join "`n")
        $o += $fence
        $o += ('(cut at ' + $MaxNewFileLines + ' of ' + $lines.Count + ' lines)')
      } else {
        $o += $text.TrimEnd()
        $o += $fence
      }
    }
    $o += ''
  }
}

$o += '## Check output (tails)'
$tails = @(Get-ChildItem -LiteralPath $logs -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like ($Id + '.*.txt') } | Sort-Object Name)
if ($tails.Count -eq 0) { $o += 'None.' }
foreach ($t in $tails) {
  $o += ('### ' + $t.Name)
  $o += $fence
  $o += (Get-Tail -Text (Read-Utf8 -Path $t.FullName) -Lines 40)
  $o += $fence
}

Write-Utf8 -Path $outPath -Text (($o -join "`n") + "`n")
Write-Host ('Review pack written: .handoff/review/' + $Id + '.md')
exit 0

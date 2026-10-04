<#
.SYNOPSIS
  Runs queued Grok session prompts headless through the Cursor CLI, one at a
  time, with gates between them. Owner tool for nakolabs-d2d.

.DESCRIPTION
  Reads .handoff/queue/NN-<session-id>.md in name order. For each prompt:
    1. runs Grok headless (agent -p) and saves the log,
    2. runs the gates (report, allow list, database and git safety, tsc,
       eslint, the prompt's own checks),
    3. on PASS: makes a checkpoint commit "wip(<id>)" on run/<Batch>,
       writes a review pack, pings the phone, moves on,
    4. on FAIL: leaves the changes uncommitted, writes a review pack,
       pings the phone and STOPS.
  A prompt whose runner block says "gate: human" always stops the queue
  after it, pass or fail.

  This script is the only thing that commits, and only on run/* branches.
  See scripts/agent/README.md.

.EXAMPLE
  .\scripts\agent\run-queue.ps1 -Batch ui-5 -DryRun
  .\scripts\agent\run-queue.ps1 -Batch ui-5
  .\scripts\agent\run-queue.ps1 -Batch ui-5 -Max 1
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Batch,
  [string]$Model = 'grok-4.7-high',
  [int]$TimeoutMinutes = 45,
  [int]$Max = 0,
  [switch]$DryRun,
  [string[]]$AgentArgs = @()
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'lib.ps1')

function Stop-Runner {
  param([string]$Message, [int]$Code = 1)
  Write-Host ''
  Write-Host $Message
  exit $Code
}

# ---------------------------------------------------------------- inputs
if ($Batch -notmatch '^[a-z0-9][a-z0-9-]*$') { Stop-Runner 'Batch must be lower-case letters, digits and dashes, e.g. ui-5.' }
if ($Model -notmatch '^[A-Za-z0-9._\-\[\]=,]+$') { Stop-Runner "Model id looks wrong: $Model" }
foreach ($a in $AgentArgs) {
  if ($a -notmatch '^[A-Za-z0-9._=\-]+$') { Stop-Runner "Agent argument not allowed: $a" }
}

try { Set-RepoRoot } catch { Stop-Runner $_.Exception.Message }

$Handoff = Join-Path $script:RepoRoot '.handoff'
$Dir = @{
  queue   = Join-Path $Handoff 'queue'
  done    = Join-Path $Handoff 'done'
  failed  = Join-Path $Handoff 'failed'
  reports = Join-Path $Handoff 'reports'
  logs    = Join-Path $Handoff 'logs'
  review  = Join-Path $Handoff 'review'
}
foreach ($d in $Dir.Values) {
  if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

# ---------------------------------------------------------------- preflight
$issues = @()
$warnings = @()

$agentCmd = Get-Command agent -ErrorAction SilentlyContinue | Select-Object -First 1
$agentPrefix = $null
if (-not $agentCmd) {
  $issues += 'Cursor CLI "agent" not found on PATH. Install it and run "agent login".'
} else {
  $agentPath = $agentCmd.Source
  if (-not $agentPath) { $agentPath = $agentCmd.Name }
  if ($agentPath -like '*.ps1') {
    $agentPrefix = 'powershell -NoProfile -ExecutionPolicy Bypass -File "' + $agentPath + '"'
  } else {
    $agentPrefix = '"' + $agentPath + '"'
  }
}

if ((Invoke-Git 'check-ignore -q .handoff/queue/probe.md').ExitCode -ne 0) {
  $issues += '.handoff/ is not ignored by git. Add /.handoff/ to .gitignore.'
}
if ((Invoke-Git 'check-ignore -q "Claude outputs/probe.md"').ExitCode -ne 0) {
  $issues += '"Claude outputs/" is not ignored by git. Add /Claude outputs/ to .gitignore.'
}

$dirty = @(Get-ChangedFiles)
if ($dirty.Count -gt 0) {
  $issues += ('Working tree is not clean (' + $dirty.Count + ' changed files). Commit or discard first. See README "Recovery".')
}

$queue = @(Get-ChildItem -LiteralPath $Dir.queue -Filter '*.md' -File | Sort-Object Name)
if ($queue.Count -eq 0) { $issues += 'Queue is empty: put prompts in .handoff/queue/ named NN-<session-id>.md' }

if (-not $env:D2D_NTFY) { $warnings += 'D2D_NTFY is not set, so there will be no phone pings.' }

$branch = 'run/' + $Batch
Write-Host ''
Write-Host ('Repo:   ' + $script:RepoRoot)
Write-Host ('Branch: ' + (Get-CurrentBranch) + '  ->  ' + $branch)
Write-Host ('Model:  ' + $Model + '   Timeout: ' + $TimeoutMinutes + ' min per session')
Write-Host ('Queue:  ' + $queue.Count + ' prompt(s)')
foreach ($w in $warnings) { Write-Host ('WARN  ' + $w) }
foreach ($i in $issues) {
  if ($DryRun) { Write-Host ('WARN  ' + $i) } else { Write-Host ('STOP  ' + $i) }
}
if ($issues.Count -gt 0 -and -not $DryRun) { Stop-Runner 'Preflight failed. Nothing was run.' }

# ---------------------------------------------------------------- branch
if (-not $DryRun) {
  $current = Get-CurrentBranch
  if ($current -ne $branch) {
    if ($current -notlike 'run/*' -and $current -ne 'main') {
      Write-Host ('WARN  starting run branch from ' + $current + ', not main')
    }
    $exists = (Invoke-Git ('show-ref --verify --quiet refs/heads/' + $branch)).ExitCode -eq 0
    if ($exists) { $sw = Invoke-Git ('switch ' + $branch) } else { $sw = Invoke-Git ('switch -c ' + $branch) }
    if ($sw.ExitCode -ne 0) { Stop-Runner ('Could not switch to ' + $branch + ': ' + $sw.Output.Trim()) }
  }
  $env:D2D_RUNNER = '1'
}

# ---------------------------------------------------------------- sessions
$ran = 0
$summary = @()
foreach ($file in $queue) {
  if ($Max -gt 0 -and $ran -ge $Max) { break }

  if ($file.Name -notmatch '^[A-Za-z0-9._-]+\.md$') { Stop-Runner ('Bad prompt file name: ' + $file.Name) }
  $id = ($file.BaseName -replace '^\d+-', '').ToLower()
  if ($id -notmatch '^[a-z0-9][a-z0-9.-]*$') { Stop-Runner ('Bad session id from file name: ' + $file.Name) }

  $promptText = Read-Utf8 -Path $file.FullName
  $block = Get-RunnerBlock -Text $promptText
  $edits = @(Get-EditNumbers -Text $promptText)

  Write-Host ''
  Write-Host ('=== ' + $id + ' (' + $file.Name + ')')
  if ($null -eq $block -or ($block.Gate -ne 'auto' -and $block.Gate -ne 'human')) {
    Write-Host '    No valid <!-- runner --> block (gate: auto or human). Not run.'
    if (-not $DryRun) {
      Move-Item -LiteralPath $file.FullName -Destination (Join-Path $Dir.failed $file.Name) -Force
      Send-Ping ($id + ': not run, prompt has no runner block')
      Stop-Runner 'Stopped.'
    }
    continue
  }
  Write-Host ('    gate: ' + $block.Gate + '   edits: ' + ($edits -join ',') + '   db-writes: ' + $block.DbWrites)
  Write-Host ('    allow: ' + ($block.Allow -join ' | '))
  Write-Host ('    checks: ' + ($block.Checks -join ' | '))

  $rel = '.handoff/queue/' + $file.Name
  $reportRel = '.handoff/reports/' + $id + '.md'
  $message = 'Session ' + $id + '. Read the file ' + $rel + ' and carry it out exactly. ' +
    'It is your whole brief and follows .cursor/rules/50-plan-execution.mdc. ' +
    'You are running headless under the queue runner: do not open a browser, do not ask questions, ' +
    'never commit and never run state-changing git. Write your report to ' + $reportRel + ' before you stop.'
  $extra = ''
  if ($AgentArgs.Count -gt 0) { $extra = ' ' + ($AgentArgs -join ' ') }
  $commandLine = $agentPrefix + ' -p --force --trust --approve-mcps --model ' + $Model +
    ' --output-format stream-json' + $extra + ' "' + $message + '"'

  if ($DryRun) {
    Write-Host ('    would run: agent -p --force --trust --approve-mcps --model ' + $Model + ' --output-format stream-json' + $extra + ' "<message>"')
    Write-Host ('    message: ' + $message)
    continue
  }

  $ran++
  $problems = @()
  $notes = @()
  $reportPath = Join-Path $Dir.reports ($id + '.md')
  if (Test-Path -LiteralPath $reportPath) { Remove-Item -LiteralPath $reportPath -Force }
  $logPath = Join-Path $Dir.logs ($id + '.jsonl')

  Write-Host ('    Grok started ' + (Get-Date -Format 'HH:mm'))
  $run = Invoke-Cmd -CommandLine $commandLine -OutFile $logPath -TimeoutSec ($TimeoutMinutes * 60) -Heartbeat
  if ($run.TimedOut) { $problems += ('timed out after ' + $TimeoutMinutes + ' min') }
  elseif ($run.ExitCode -ne 0) { $problems += ('agent exited with code ' + $run.ExitCode) }

  # log scan: database and git safety, final message
  $scan = Test-AgentLog -LogText $run.Output -Block $block
  $problems += $scan.Problems
  if ($scan.Final) { Write-Utf8 -Path (Join-Path $Dir.logs ($id + '.final.md')) -Text $scan.Final }

  # report
  $report = Read-Utf8 -Path $reportPath
  if (-not $report) {
    if ($scan.Final) {
      $report = $scan.Final
      $notes += 'Report file missing; used the agent final message instead.'
      Write-Utf8 -Path $reportPath -Text $report
    } else {
      $problems += 'no report file and no final message'
      $report = ''
    }
  }
  if ($report) { $problems += @(Test-Report -Report $report -Edits $edits) }
  if ($edits.Count -eq 0) { $notes += 'Prompt has no EDIT n headings, so the edit check was skipped.' }
  $notVerified = ([regex]::Matches($report, 'NOT VERIFIED')).Count
  if ($notVerified -gt 0) { $notes += ($notVerified.ToString() + ' check(s) marked NOT VERIFIED; see report.') }

  # changed files
  $changed = @(Get-ChangedFiles)
  $problems += @(Test-ChangedFiles -Changed $changed -Block $block)

  # tsc
  Write-Host '    gate: tsc'
  $tsc = Invoke-Cmd -CommandLine 'npx tsc --noEmit' -OutFile (Join-Path $Dir.logs ($id + '.tsc.txt')) -TimeoutSec 900
  if ($tsc.ExitCode -ne 0) { $problems += 'tsc failed' }

  # eslint on changed files that still exist
  $lintable = @($changed | Where-Object {
      ($_ -match '\.(ts|tsx|js|jsx|mjs|cjs)$') -and (Test-Path -LiteralPath (Join-Path $script:RepoRoot $_))
    })
  $lintOut = ''
  if ($lintable.Count -gt 0) {
    Write-Host ('    gate: eslint (' + $lintable.Count + ' files)')
    for ($i = 0; $i -lt $lintable.Count; $i += 40) {
      $chunk = $lintable[$i..([Math]::Min($i + 39, $lintable.Count - 1))]
      $quoted = ($chunk | ForEach-Object { '"' + $_ + '"' }) -join ' '
      $lint = Invoke-Cmd -CommandLine ('npx eslint --cache --cache-location .handoff/.eslintcache ' + $quoted) -TimeoutSec 900
      $lintOut += $lint.Output
      if ($lint.ExitCode -ne 0) { $problems += 'eslint reported errors' }
    }
  }
  Write-Utf8 -Path (Join-Path $Dir.logs ($id + '.eslint.txt')) -Text $lintOut

  # the prompt's own checks
  $checkResults = @()
  $n = 0
  foreach ($check in $block.Checks) {
    $n++
    Write-Host ('    gate: ' + $check)
    $c = Invoke-Cmd -CommandLine $check -OutFile (Join-Path $Dir.logs ($id + '.check-' + $n + '.txt')) -TimeoutSec 1200
    $status = 'PASS'
    if ($c.ExitCode -ne 0) { $status = 'FAIL'; $problems += ('check failed: ' + $check) }
    $checkResults += ('- ' + $status + '  `' + $check + '`')
  }

  $problems = @($problems | Where-Object { $_ } | Select-Object -Unique)
  $passed = ($problems.Count -eq 0)

  # checkpoint commit
  # Stages exactly the files Grok changed (checked above), never gate artifacts.
  $sha = ''
  if ($passed -and $changed.Count -gt 0) {
    $addFailed = $false
    for ($i = 0; $i -lt $changed.Count; $i += 40) {
      $chunk = $changed[$i..([Math]::Min($i + 39, $changed.Count - 1))]
      $specs = ($chunk | ForEach-Object { '":(literal)' + $_ + '"' }) -join ' '
      if ((Invoke-Git ('add -A -- ' + $specs)).ExitCode -ne 0) { $addFailed = $true }
    }
    $commit = Invoke-Git ('commit -q -m "wip(' + $id + '): runner checkpoint" -m "Gates passed. Not reviewed yet."')
    if ($addFailed -or $commit.ExitCode -ne 0) {
      $passed = $false
      $problems += ('checkpoint commit failed: ' + $commit.Output.Trim())
    } else {
      $sha = (Invoke-Git 'rev-parse --short HEAD').Output.Trim()
    }
  }

  # gate file
  $result = 'FAIL'
  if ($passed) { $result = 'PASS' }
  $g = @()
  $g += ('Result: **' + $result + '**   Gate: ' + $block.Gate + '   Checkpoint: ' + $(if ($sha) { $sha } else { 'none' }))
  $g += ''
  $g += 'Problems:'
  if ($problems.Count -eq 0) { $g += '- none' } else { foreach ($p in $problems) { $g += ('- ' + $p) } }
  $g += ''
  $g += 'Notes:'
  if ($notes.Count -eq 0) { $g += '- none' } else { foreach ($x in $notes) { $g += ('- ' + $x) } }
  $g += ''
  $g += 'Checks:'
  $g += ('- ' + $(if ($tsc.ExitCode -eq 0) { 'PASS' } else { 'FAIL' }) + '  `npx tsc --noEmit`')
  if ($lintable.Count -gt 0) { $g += ('- ' + $(if ($problems -contains 'eslint reported errors') { 'FAIL' } else { 'PASS' }) + '  eslint on ' + $lintable.Count + ' changed files') }
  $g += $checkResults
  $g += ''
  $g += ('Changed files (' + $changed.Count + '):')
  foreach ($f in $changed) { $g += ('- ' + $f) }
  Write-Utf8 -Path (Join-Path $Dir.logs ($id + '.gates.md')) -Text (($g -join "`n") + "`n")

  # review pack
  if ($sha) {
    & (Join-Path $PSScriptRoot 'review-pack.ps1') -Id $id -Commit $sha | Out-Null
  } else {
    & (Join-Path $PSScriptRoot 'review-pack.ps1') -Id $id | Out-Null
  }

  # move the prompt, ping, decide
  if ($passed) {
    Move-Item -LiteralPath $file.FullName -Destination (Join-Path $Dir.done $file.Name) -Force
  } else {
    Move-Item -LiteralPath $file.FullName -Destination (Join-Path $Dir.failed $file.Name) -Force
  }
  $line = $id + ': ' + $result
  if (-not $passed) { $line += ' (' + ($problems | Select-Object -First 1) + ')' }
  Write-Host ('    ' + $line)
  foreach ($p in $problems) { Write-Host ('      - ' + $p) }
  $summary += $line

  if (-not $passed) {
    Send-Ping ($line + '. Queue stopped.')
    Stop-Runner ('Stopped on failure. Review pack: .handoff/review/' + $id + '.md')
  }
  $leftover = @(Get-ChangedFiles)
  if ($leftover.Count -gt 0) {
    Send-Ping ($line + '. Stopped: stray files after the gates.')
    Stop-Runner ('Stopped: files appeared during the gates and would break the next session: ' + ($leftover -join ', ') + '. Add them to .gitignore (or delete them), then run again.')
  }
  if ($block.Gate -eq 'human') {
    Send-Ping ($line + '. Stopped for review (gate: human).')
    Stop-Runner ('Stopped for review (gate: human). Review pack: .handoff/review/' + $id + '.md') 0
  }
  Send-Ping $line
}

Write-Host ''
if ($DryRun) { Write-Host 'Dry run finished. Nothing was run or changed.'; exit 0 }
Write-Host 'Queue finished.'
foreach ($s in $summary) { Write-Host ('  ' + $s) }
if ($ran -gt 0) { Send-Ping ('Batch ' + $Batch + ' finished: ' + $ran + ' session(s) passed.') }
exit 0

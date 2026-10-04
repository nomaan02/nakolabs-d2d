# Shared helpers for scripts/agent/*.ps1 (owner tooling, nakolabs-d2d).
# Windows PowerShell 5.1 compatible. ASCII only. No new dependencies.
# Every native command runs through cmd.exe with its output redirected to a
# file, so stderr never turns into a PowerShell error and UTF-8 survives.

$script:Utf8NoBom = New-Object System.Text.UTF8Encoding $false
if (-not (Get-Variable -Name RepoRoot -Scope Script -ErrorAction SilentlyContinue)) {
  $script:RepoRoot = (Get-Location).Path
}
try { [Console]::OutputEncoding = $script:Utf8NoBom } catch { }

# Paths that always count as allowed for a session (Grok updates these every time).
$script:DefaultAllow = @(
  'docs/BUILD-LOG.md',
  'docs/CLAUDE-HANDOFF.md',
  'docs/FIELD-TEST-BUILD-PLAN.md'
)

# Paths a runner session may never change, even if a prompt allows them.
$script:AlwaysDeny = @(
  '.env*',
  '.gitignore',
  'scripts/agent/*',
  '.cursor/hooks.json',
  '.cursor/hooks/*'
)

# Diff noise left out of review packs.
$script:DiffExcludes = @(
  'lib/supabase/types.ts',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock'
)

function Write-Utf8 {
  param([Parameter(Mandatory = $true)][string]$Path, [string]$Text)
  if ($null -eq $Text) { $Text = '' }
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Path, $Text, $script:Utf8NoBom)
}

function Read-Utf8 {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
}

function Get-Prop {
  param($Object, [string]$Name)
  if ($null -eq $Object) { return $null }
  if ($Object -is [string]) { return $null }
  $p = $Object.PSObject.Properties[$Name]
  if ($null -eq $p) { return $null }
  return $p.Value
}

function Get-Tail {
  param([string]$Text, [int]$Lines = 40)
  if (-not $Text) { return '' }
  $all = $Text -split "`r?`n"
  if ($all.Count -le $Lines) { return ($all -join "`n") }
  return ($all[($all.Count - $Lines)..($all.Count - 1)] -join "`n")
}

# Runs one command line through cmd.exe. Output (stdout + stderr) goes to
# OutFile. Returns ExitCode (-1 on timeout), TimedOut and Output.
function Invoke-Cmd {
  param(
    [Parameter(Mandatory = $true)][string]$CommandLine,
    [string]$OutFile,
    [int]$TimeoutSec = 0,
    [switch]$Heartbeat
  )
  $isTemp = $false
  if (-not $OutFile) { $OutFile = [System.IO.Path]::GetTempFileName(); $isTemp = $true }
  $dir = Split-Path -Parent $OutFile
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = '/d /s /c "' + $CommandLine + ' > "' + $OutFile + '" 2>&1"'
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.WorkingDirectory = $script:RepoRoot
  $proc = [System.Diagnostics.Process]::Start($psi)
  $timedOut = $false
  $started = Get-Date
  if ($TimeoutSec -le 0) {
    $proc.WaitForExit()
  } else {
    $deadline = $started.AddSeconds($TimeoutSec)
    while ($true) {
      $remainingMs = [int][Math]::Max(1000, [Math]::Min(60000, ($deadline - (Get-Date)).TotalMilliseconds))
      if ($proc.WaitForExit($remainingMs)) { break }
      if ((Get-Date) -ge $deadline) {
        $timedOut = $true
        Start-Process -FilePath 'taskkill.exe' -ArgumentList @('/PID', [string]$proc.Id, '/T', '/F') -WindowStyle Hidden -Wait
        [void]$proc.WaitForExit(15000)
        break
      }
      if ($Heartbeat) {
        $mins = [int]((Get-Date) - $started).TotalMinutes
        Write-Host ('    ... still running ({0} min)' -f $mins)
      }
    }
  }
  $exit = -1
  if (-not $timedOut) { $exit = $proc.ExitCode }
  $text = Read-Utf8 -Path $OutFile
  if ($null -eq $text) { $text = '' }
  if ($isTemp) { Remove-Item -LiteralPath $OutFile -Force -ErrorAction SilentlyContinue }
  return [pscustomobject]@{ ExitCode = $exit; TimedOut = $timedOut; Output = $text; OutFile = $OutFile }
}

function Invoke-Git {
  param([Parameter(Mandatory = $true)][string]$GitArgs)
  return Invoke-Cmd -CommandLine ('git -c core.quotepath=false ' + $GitArgs)
}

function Set-RepoRoot {
  $r = Invoke-Git 'rev-parse --show-toplevel'
  if ($r.ExitCode -ne 0) { throw 'Not inside a git repository. Run this from the nakolabs-d2d folder.' }
  $script:RepoRoot = ($r.Output.Trim() -replace '/', '\')
  Set-Location -LiteralPath $script:RepoRoot
  [Environment]::CurrentDirectory = $script:RepoRoot
}

function Get-CurrentBranch {
  return (Invoke-Git 'rev-parse --abbrev-ref HEAD').Output.Trim()
}

# Changed paths in the working tree (modified, staged, untracked), forward slashes.
function Get-ChangedFiles {
  $r = Invoke-Git 'status --porcelain --untracked-files=all'
  $files = @()
  foreach ($line in ($r.Output -split "`r?`n")) {
    if ($line.Length -lt 4) { continue }
    $path = $line.Substring(3)
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
    $path = $path.Trim().Trim('"')
    if ($path) { $files += $path }
  }
  return $files
}

# Wildcard match where * and ? are wildcards but [ ] are literal
# (Next.js folders like app/[id] must match exactly).
function Test-PathPattern {
  param([string]$Path, [string]$Pattern)
  $p = ($Pattern.Trim() -replace '\\', '/') -replace '^\./', ''
  $f = ($Path.Trim() -replace '\\', '/') -replace '^\./', ''
  if ($p -notmatch '[\*\?]') { return ($f -ieq $p) }
  $escaped = ($p -replace '\[', '`[') -replace '\]', '`]'
  return ($f -like $escaped)
}

function Test-AnyPattern {
  param([string]$Path, [string[]]$Patterns)
  foreach ($pat in $Patterns) {
    if ($pat -and (Test-PathPattern -Path $Path -Pattern $pat)) { return $true }
  }
  return $false
}

function Send-Ping {
  param([string]$Message)
  if (-not $env:D2D_NTFY) { return }
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-RestMethod -Method Post -Uri ('https://ntfy.sh/' + $env:D2D_NTFY) -Body $Message -TimeoutSec 15 | Out-Null
  } catch {
    Write-Host ('    (phone ping failed: ' + $_.Exception.Message + ')')
  }
}

# ---------------------------------------------------------------------------
# Prompt and report parsing (used by run-queue.ps1)
# ---------------------------------------------------------------------------

# Reads the <!-- runner ... --> block at the top of a session prompt.
# Returns $null when there is no block.
function Get-RunnerBlock {
  param([string]$Text)
  $m = [regex]::Match($Text, '(?s)<!--\s*runner\b(.*?)-->')
  if (-not $m.Success) { return $null }
  $block = [pscustomobject]@{ Gate = ''; Allow = @(); Checks = @(); DbWrites = $false }
  $section = ''
  foreach ($raw in ($m.Groups[1].Value -split "`r?`n")) {
    $line = $raw.Trim()
    if (-not $line) { continue }
    if ($line -match '^gate:\s*(\S+)\s*$') { $block.Gate = $Matches[1].ToLower(); $section = ''; continue }
    if ($line -match '^db-writes:\s*(\S+)\s*$') { $block.DbWrites = ($Matches[1].ToLower() -eq 'allowed'); $section = ''; continue }
    if ($line -match '^allow:\s*$') { $section = 'allow'; continue }
    if ($line -match '^checks:\s*$') { $section = 'checks'; continue }
    if ($line -match '^-\s+(.+)$') {
      $item = $Matches[1].Trim().Trim('`')
      if ($section -eq 'allow') { $block.Allow += $item }
      elseif ($section -eq 'checks') { $block.Checks += $item }
    }
  }
  return $block
}

# EDIT numbers declared in a prompt: lines starting "EDIT n", "### EDIT n" or "**EDIT n".
function Get-EditNumbers {
  param([string]$Text)
  $nums = @()
  foreach ($m in [regex]::Matches($Text, '(?m)^[ \t]{0,3}(?:#{1,6}[ \t]+)?(?:\*\*)?EDIT[ \t]+(\d+)\b')) {
    $nums += [int]$m.Groups[1].Value
  }
  return @($nums | Sort-Object -Unique)
}

# Checks Grok's report against the prompt's EDIT numbers.
function Test-Report {
  param([string]$Report, [int[]]$Edits)
  $problems = @()
  foreach ($n in $Edits) {
    $notDone = [regex]::IsMatch($Report, "(?i)\bEDIT\s+$n\b[^\r\n]{0,40}\bNOT\s+DONE\b")
    $done = [regex]::IsMatch($Report, "(?i)\bEDIT\s+$n\W{0,6}DONE\b")
    if ($notDone) { $problems += "EDIT $n is NOT DONE" }
    elseif (-not $done) { $problems += "EDIT $n has no DONE line in the report" }
  }
  if ([regex]::IsMatch($Report, '\b(BLOCKED|PARTIAL)\b')) {
    $problems += 'report says BLOCKED or PARTIAL'
  }
  return $problems
}

# Scans the CLI stream-json log. Flags unplanned database writes and
# state-changing git. Also returns the agent's final message.
function Test-AgentLog {
  param([string]$LogText, $Block)
  $problems = @()
  $final = $null
  $gitPattern = '(?i)\bgit\s+(commit|push|reset|checkout|switch|stash|clean|rebase|merge|worktree)\b'
  $sqlWrite = '(?i)\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b'
  foreach ($line in ($LogText -split "`r?`n")) {
    $t = $line.Trim()
    if (-not $t.StartsWith('{')) { continue }
    $ev = $null
    try { $ev = $t | ConvertFrom-Json } catch { continue }
    $type = Get-Prop $ev 'type'
    if ($type -eq 'result') {
      $r = Get-Prop $ev 'result'
      if ($r) { $final = [string]$r }
      continue
    }
    if ($type -ne 'tool_call') { continue }
    if ((Get-Prop $ev 'subtype') -ne 'started') { continue }
    $tc = Get-Prop $ev 'tool_call'
    if ($null -eq $tc) { continue }
    $json = $tc
    if (-not ($tc -is [string])) { $json = $tc | ConvertTo-Json -Depth 30 -Compress }
    if ($json -match '"mcp[A-Za-z]*"\s*:') {
      if ($json -match 'apply_migration' -and $Block.Gate -ne 'human') {
        $problems += 'apply_migration was called in a gate:auto session'
      }
      if ($json -match 'execute_sql' -and $json -match $sqlWrite -and -not $Block.DbWrites) {
        $problems += 'execute_sql ran with a write keyword (insert/update/delete/ddl)'
      }
    } elseif ($json -match '"(shell|terminal)[A-Za-z]*"\s*:') {
      if ($json -match $gitPattern) {
        $problems += 'the agent ran a state-changing git command'
      }
    }
  }
  return [pscustomobject]@{ Problems = @($problems | Select-Object -Unique); Final = $final }
}

# Allow-list gate for the files a session changed.
function Test-ChangedFiles {
  param([string[]]$Changed, $Block)
  $problems = @()
  $allow = @($Block.Allow) + $script:DefaultAllow
  foreach ($f in $Changed) {
    if (Test-AnyPattern -Path $f -Patterns $script:AlwaysDeny) {
      $problems += "changed a protected file: $f"
      continue
    }
    if ((Test-PathPattern -Path $f -Pattern 'supabase/migrations/*') -and $Block.Gate -ne 'human') {
      $problems += "migration file in a gate:auto session: $f"
      continue
    }
    if (-not (Test-AnyPattern -Path $f -Patterns $allow)) {
      $problems += "not on the allow list: $f"
    }
  }
  return $problems
}

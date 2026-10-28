# ==========================================================
#  임용쏙 배포 스크립트
#
#  ⚠️ 직접 `npx wrangler deploy` 하지 말 것.
#     wrangler.toml 의 [assets] directory 가 저장소 루트(".")라서
#     그냥 배포하면 .git/ 이 웹에 그대로 공개된다 (2026-10-28 실제로 공개돼 있었음).
#     .assetsignore 에 .git 을 적어도 wrangler v4 가 무시하는 경우가 있어,
#     "올릴 것만 임시 폴더에 담아" 배포하는 방식으로 우회한다.
# ==========================================================

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot

# --- 올릴 것만 고르는 허용 목록 ---
$files = @('index.html')
$dirs  = @('css', 'js')

$stage = Join-Path $env:TEMP ("imyong-ssok-deploy-" + (Get-Random))
New-Item -ItemType Directory -Path $stage -Force | Out-Null

try {
  foreach ($f in $files) {
    $p = Join-Path $src $f
    if (-not (Test-Path $p)) { throw "필수 파일이 없습니다: $f" }
    Copy-Item $p -Destination $stage
  }
  foreach ($d in $dirs) {
    $p = Join-Path $src $d
    if (-not (Test-Path $p)) { throw "필수 폴더가 없습니다: $d" }
    Copy-Item $p -Destination $stage -Recurse
  }

  # wrangler 설정은 배포에 필요하지만 에셋으로는 올라가면 안 됨
  Copy-Item (Join-Path $src 'wrangler.toml') -Destination $stage

  # ⚠️ 스테이지 폴더에 .assetsignore 를 직접 써 넣는다.
  #    wrangler 가 배포 중 스테이지 안에 .wrangler/ 를 새로 만들기 때문에,
  #    복사 단계에서 제외하는 것만으로는 계정 파일 노출을 막을 수 없다.
  @('.wrangler', 'wrangler.toml', '.assetsignore', '.git', '*.md', '.claude', 'deploy.ps1') |
    Set-Content -Path (Join-Path $stage '.assetsignore') -Encoding UTF8

  Write-Host "`n[1/3] 올릴 파일" -ForegroundColor Cyan
  Get-ChildItem $stage -Recurse -File |
    Where-Object { $_.FullName -notlike "*\.wrangler\*" } |
    ForEach-Object { Write-Host ("  " + $_.FullName.Substring($stage.Length + 1)) }

  Write-Host "`n[2/3] 배포" -ForegroundColor Cyan
  Push-Location $stage
  try { npx wrangler deploy } finally { Pop-Location }
  if ($LASTEXITCODE -ne 0) { throw "wrangler deploy 실패 (exit $LASTEXITCODE)" }

  # --- 배포 후 실제로 요청해서 노출 여부를 본문으로 확인 ---
  # 상태 코드만 보면 안 된다: SPA 폴백을 쓰는 프로젝트는 없는 경로도 200 + 셸 HTML 을 준다.
  Write-Host "`n[3/3] 노출 점검" -ForegroundColor Cyan
  Start-Sleep -Seconds 3
  $base = 'https://imyong-ssok.samluv.workers.dev'
  $checks = @{
    '/.git/config'                        = '[core]'
    '/.git/HEAD'                          = 'ref:'
    '/.wrangler/cache/wrangler-account.json' = 'account'
    '/wrangler.toml'                      = '[assets]'
    '/deploy.ps1'                         = 'wrangler'
  }
  $leaked = @()
  foreach ($path in $checks.Keys) {
    $body = $null
    try {
      $r = Invoke-WebRequest -Uri ($base + $path) -Headers @{ 'Cache-Control' = 'no-cache' } -UseBasicParsing -TimeoutSec 20
      $body = [string]$r.Content
    } catch { $body = $null }   # 404 등은 안전
    if ($body -and $body.Contains($checks[$path])) {
      $leaked += $path
      Write-Host ("  노출됨  " + $path) -ForegroundColor Red
    } else {
      Write-Host ("  안전    " + $path) -ForegroundColor Green
    }
  }
  if ($leaked.Count -gt 0) { throw ("민감 파일이 웹에 노출되었습니다: " + ($leaked -join ', ')) }

  Write-Host "`n완료 — $base" -ForegroundColor Green
}
finally {
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

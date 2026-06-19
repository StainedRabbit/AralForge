param(
    [string]$DatabasePath = "backend/db.sqlite3",
    [string]$BackupDir = "backend/backups"
)

if (-not (Test-Path -LiteralPath $DatabasePath)) {
    Write-Error "Database not found: $DatabasePath"
    exit 1
}

New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$target = Join-Path $BackupDir "db-$timestamp.sqlite3"

Copy-Item -LiteralPath $DatabasePath -Destination $target
Write-Output "SQLite backup created: $target"

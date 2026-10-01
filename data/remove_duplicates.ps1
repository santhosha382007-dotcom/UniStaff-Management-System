# PowerShell script to remove duplicate rows from attendance.sqlite
# --------------------------------------------------------------
# Download sqlite3.exe if needed, list tables, delete duplicates
# --------------------------------------------------------------

# 1. Ensure sqlite3 CLI is available
$sqliteUrl = "https://www.sqlite.org/2024/sqlite-tools-win-x64-3450300.zip"
$zipPath   = "$PSScriptRoot\sqlite-tools.zip"
$exePath   = "$PSScriptRoot\sqlite3.exe"

if (-Not (Test-Path $exePath)) {
    Write-Host "Downloading SQLite tools..."
    Invoke-WebRequest -Uri $sqliteUrl -OutFile $zipPath
    Write-Host "Extracting sqlite3.exe..."
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $PSScriptRoot)
    $extracted = Get-ChildItem $PSScriptRoot -Recurse -Filter "sqlite3.exe" | Select-Object -First 1
    if ($extracted) {
        Move-Item $extracted.FullName $exePath -Force
        Write-Host "sqlite3.exe ready at $exePath"
    } else {
        Write-Error "Failed to locate sqlite3.exe after extraction."
        exit 1
    }
    Remove-Item $zipPath -Force
}

# Helper to run a SQLite command (currently unused)
function Invoke-Sqlite {
    param([string]$Sql)
    & $exePath "$dbPath" "$Sql"
}

# 2. Define database path
$dbPath = Join-Path $PSScriptRoot "attendance.sqlite"
if (-Not (Test-Path $dbPath)) {
    Write-Error "Database not found at $dbPath"
    exit 1
}

# 3. Get list of tables
$tablesOutput = & $exePath $dbPath ".tables"
$tables = $tablesOutput -split "\s+" | Where-Object { $_ -ne "" }
if ($tables.Count -eq 0) {
    Write-Host "No tables found in the database."
    exit 0
}
Write-Host "Found tables:" $tables

# 4. Process each table and delete duplicate rows
foreach ($tbl in $tables) {
    Write-Host "`nProcessing table: $tbl"

    # Retrieve column names (ignore internal sqlite columns)
    $pragma = & $exePath $dbPath "PRAGMA table_info($tbl);"
    $cols = $pragma | ForEach-Object { ($_ -split "\|")[1] }
    if ($cols.Count -eq 0) {
        Write-Host "  No columns detected – skipping."
        continue
    }
    # Build a comma‑separated list of column names for GROUP BY
    $colList = $cols -join ", "

    $deleteSql = "DELETE FROM $tbl WHERE rowid NOT IN (SELECT MIN(rowid) FROM $tbl GROUP BY $colList);"
    & $exePath $dbPath $deleteSql > $null
    $deletedRows = & $exePath $dbPath "SELECT changes();"
    Write-Host "  Deleted duplicate rows: $deletedRows"
}

Write-Host "`nDuplicate‑removal complete."

param(
    [Parameter(Position = 0)]
    [string] $Path = "pyproject.toml"
)

$inProject = $false

foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -eq "[project]") {
        $inProject = $true
        continue
    }

    if ($line -match '^\[') {
        $inProject = $false
        continue
    }

    if ($inProject -and $line -match '^version\s*=\s*"([^"]+)"') {
        Write-Output $Matches[1]
        exit 0
    }
}

Write-Error "Could not read [project].version from $Path"
exit 1

try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw "Node.js not found. Please install Node.js." 
    }

    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

    npx playwright install chromium --with-deps --only-shell
    if ($LASTEXITCODE -ne 0) { throw "Playwright installation failed" }

    $url = Read-Host "Input the channel URL"
    if ([string]::IsNullOrWhiteSpace($url)) {
        throw "URL cannot be empty."
    }

    # 写入.env文件
    $envFilePath = Join-Path $PSScriptRoot ".env"
    "CHANNEL_URL=$url" | Set-Content -Path $envFilePath -Encoding UTF8

    Write-Host "`nInstallation completed successfully!" -ForegroundColor Green
}
catch {
    Write-Host "`nError occurred: $_`n" -ForegroundColor Red
}
finally {
    Read-Host "`nPress Enter to exit..."
}
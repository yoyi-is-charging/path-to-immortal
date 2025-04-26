npm install
npx playwright install chromium --with-deps --only-shell
$url = Read-Host "Enter the CHANNEL_URL to save to .env file"
$envFilePath = ".env"
$envContent = "CHANNEL_URL=$url"
Set-Content -Path $envFilePath -Value $envContent -Encoding utf8
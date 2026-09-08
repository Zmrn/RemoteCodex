$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:43127'
$page = Invoke-WebRequest -Uri ($url + '/') -UseBasicParsing -TimeoutSec 5
$match = [regex]::Match($page.Content, 'name="bridge-csrf" content="([a-f0-9]+)"')
if (-not $match.Success) { throw 'Expected bridge page was not found. No process was stopped.' }
Invoke-RestMethod -Uri ($url + '/api/stop') -Method Post -ContentType 'application/json' -Headers @{'X-Bridge-CSRF'=$match.Groups[1].Value} -Body '{}' -TimeoutSec 5

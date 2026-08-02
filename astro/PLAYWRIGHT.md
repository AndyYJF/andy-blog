# For Windows / Cursor agent shells

Set this before `npm run build` so BEOE Mermaid can find Chromium:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm run build
```

Install once:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npx playwright install chromium
```

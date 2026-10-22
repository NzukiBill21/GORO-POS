# Optional hardening for Iman / shop Wi‑Fi: block inbound connections to the local API port
# from other devices on the network. The app already binds 127.0.0.1; this adds a Windows rule.
# Run once as Administrator on the till PC.

param(
  [int]$Port = 3001,
  [string]$RuleName = "Goro POS - Block LAN inbound API"
)

$ErrorActionPreference = "Stop"

if (-NOT ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Run PowerShell as Administrator." -ForegroundColor Yellow
  exit 1
}

$existing = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Rule already exists: $RuleName"
  exit 0
}

New-NetFirewallRule `
  -DisplayName $RuleName `
  -Direction Inbound `
  -Action Block `
  -Protocol TCP `
  -LocalPort $Port `
  -Profile Public,Private `
  -Description "POS API is localhost-only; block Wi-Fi/LAN inbound to port $Port"

Write-Host "Created firewall rule: $RuleName (TCP $Port inbound block on Private/Public)." -ForegroundColor Green
Write-Host "Keep shop Wi-Fi on a trusted network; use WPA2/WPA3 and a strong router password."

# src/main/mail-compose/draft-outlook.ps1
# Outlook COM で新規メールを作り、宛先・件名・本文をセットして「表示」する。
# 送信は絶対に行わない（.Send() を呼ばない）。
param(
  [Parameter(Mandatory = $true)][string]$JobPath
)
$ErrorActionPreference = 'Stop'

try {
  $job = Get-Content -LiteralPath $JobPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $outlook = New-Object -ComObject Outlook.Application
  $mail = $outlook.CreateItem(0)   # 0 = olMailItem
  $mail.To = $job.to
  if ($job.cc) { $mail.CC = $job.cc }
  if ($job.bcc) { $mail.BCC = $job.bcc }
  $mail.Subject = $job.subject
  $mail.HTMLBody = $job.html
  $mail.Display()                  # 下書きウィンドウを表示するだけ
  Write-Output 'OK'
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}

# check-outlook.ps1
# インストール済みの Outlook（デスクトップ版）の受信トレイを COM で読み、
# 最近のメールを JSON で返す。パスワードは要らない（すでにサインイン済みのため）。
#
# 当たり判定（どの相手か・どの向きか）はここではやらず、JS 側の query.js に任せる。
# Gmail と Outlook で判定がずれないようにするため、ここは「最近のメールを渡す」だけ。
#
# 日本語コメントを含むため、このファイルは必ず UTF-8 BOM 付きで保存すること。
# BOM が無いと PowerShell 5.1 が Shift-JIS として読み、構文エラーになる。
param(
  [Parameter(Mandatory=$true)][string]$SinceIso,
  [int]$Limit = 300,
  [switch]$UnreadOnly
)
$ErrorActionPreference = 'Stop'

# 内部宛先（Exchange の "/O=..." 形式）は SMTP アドレスに直す。
function Get-Smtp($entry) {
  if ($null -eq $entry) { return '' }
  try {
    if ($entry.AddressEntryUserType -eq 0 -or $entry.AddressEntryUserType -eq 10) {
      $u = $entry.GetExchangeUser()
      if ($u -and $u.PrimarySmtpAddress) { return $u.PrimarySmtpAddress }
    }
    $smtp = $entry.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x39FE001E')
    if ($smtp) { return $smtp }
  } catch { }
  try { return $entry.Address } catch { return '' }
}

try {
  $outlook = New-Object -ComObject Outlook.Application
  $ns = $outlook.GetNamespace('MAPI')
  $inbox = $ns.GetDefaultFolder(6)   # olFolderInbox
  $items = $inbox.Items
  # 新しい順に並べ、古いものに当たったら打ち切る。
  # Restrict の日付は表示形式が地域設定に左右されるので使わない。
  $items.Sort('[ReceivedTime]', $true)
  $since = [datetime]::Parse($SinceIso, [System.Globalization.CultureInfo]::InvariantCulture)

  $out = New-Object System.Collections.ArrayList
  $count = 0
  foreach ($item in $items) {
    if ($count -ge $Limit) { break }
    try {
      if ($item.Class -ne 43) { continue }         # olMail 以外（会議通知など）は対象外
      if ($item.ReceivedTime -lt $since) { break } # 並べ替え済みなので以降は全部古い
      if ($UnreadOnly -and -not $item.UnRead) { continue }

      $to = New-Object System.Collections.ArrayList
      $cc = New-Object System.Collections.ArrayList
      foreach ($r in $item.Recipients) {
        $addr = Get-Smtp $r.AddressEntry
        if (-not $addr) { $addr = $r.Address }
        if ($r.Type -eq 2) { [void]$cc.Add($addr) } else { [void]$to.Add($addr) }
      }

      $from = ''
      try { $from = Get-Smtp $item.Sender } catch { }
      if (-not $from) { $from = $item.SenderEmailAddress }

      [void]$out.Add([pscustomobject]@{
        entryId    = $item.EntryID
        messageId  = ''
        receivedAt = $item.ReceivedTime.ToUniversalTime().ToString('o')
        from       = $from
        fromName   = $item.SenderName
        to         = ($to -join ', ')
        cc         = ($cc -join ', ')
        subject    = $item.Subject
        unread     = [bool]$item.UnRead
      })
      $count = $count + 1
    } catch {
      continue   # 1通読めなくても全体は止めない
    }
  }
  # 0件・1件でも必ず配列になるようにする
  $json = ConvertTo-Json -InputObject @($out) -Depth 4 -Compress
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $json
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}

param(
  [switch]$Preflight,
  [string]$Version,
  [string]$SourceCommit,
  [string]$ReleaseTag
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
if (!$IsWindows) { throw 'Run this verifier on native Windows with PowerShell 7' }
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$certificatePath = Join-Path $repo 'desktop/signing/windows-selfsigned-public.pem'
$fingerprintPath = Join-Path $repo 'desktop/signing/windows-selfsigned-fingerprint.txt'
$nodeHelper = Join-Path $PSScriptRoot 'windows-selfsigned.mjs'
$fingerprint = (Get-Content -Raw $fingerprintPath).Trim()
$certificateMetadata = & node $nodeHelper certificate
if ($LASTEXITCODE -ne 0) { throw 'Pinned public signing identity validation failed' }
$certificateMetadata = $certificateMetadata | ConvertFrom-Json
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ('keating-selfsigned-verify-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  $archive = Join-Path $temporary 'osslsigncode.zip'
  Invoke-WebRequest -Uri 'https://github.com/mtrojnar/osslsigncode/releases/download/2.10/osslsigncode-2.10-windows-x64-mingw.zip' -OutFile $archive
  $archiveSHA256 = '7909bf36673484a46467004e67132d8340ec4a45ebbbc1055621bdb9262a81cd'
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $archiveSHA256) { throw 'Signature verifier archive checksum mismatch' }
  Expand-Archive -Path $archive -DestinationPath (Join-Path $temporary 'tool')
  $verifier = Join-Path $temporary 'tool/bin/osslsigncode.exe'
  $toolVersion = (& $verifier --version 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0 -or $toolVersion -notmatch 'osslsigncode 2\.10') { throw 'Wrong signature verifier version' }

  # This is a temporary PEM bundle of existing public roots, not a trust-store
  # import. The code-signing leaf is trusted only by the verifier's -CAfile.
  $tsaRoots = Join-Path $temporary 'timestamp-roots.pem'
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
  $rootPEMs = [System.Collections.Generic.List[string]]::new()
  try {
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
    foreach ($root in $store.Certificates) {
      $encoded = [Convert]::ToBase64String($root.RawData, [Base64FormattingOptions]::InsertLineBreaks)
      $rootPEMs.Add("-----BEGIN CERTIFICATE-----`n$encoded`n-----END CERTIFICATE-----`n")
    }
  } finally { $store.Close() }
  if ($rootPEMs.Count -eq 0) { throw 'No trusted timestamp roots available' }
  [System.IO.File]::WriteAllText($tsaRoots, ($rootPEMs -join ''), [System.Text.UTF8Encoding]::new($false))

  if ($Preflight) {
    # A credential-free negative check: a Windows system binary must never
    # pass as a file signed by the pinned Keating preview identity.
    $systemBinary = Join-Path $env:WINDIR 'System32/cmd.exe'
    $negativeOutput = (& $verifier verify -CAfile $certificatePath -TSA-CAfile $tsaRoots -require-leaf-hash "sha256:$fingerprint" -index 0 -in $systemBinary 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -or $negativeOutput -notmatch 'Leaf hash match: failed|No signature found') { throw 'Expected rejection of another binary was not demonstrated' }
    Write-Host 'Windows preflight passed: public identity, pinned verifier and rejection of another binary. No signing or packaged-runtime proof yet.'
    exit 0
  }

  if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $SourceCommit -notmatch '^[a-f0-9]{40}$' -or $ReleaseTag -ne "windows-selfsigned-v$Version") {
    throw 'Full verification requires a source version, complete commit and matching preview tag'
  }
  $actualCommit = (& git -C $repo rev-parse HEAD).Trim()
  if ($LASTEXITCODE -ne 0 -or $actualCommit -ne $SourceCommit) { throw 'Source commit does not match checkout' }
  $tagCommit = (& git -C $repo rev-parse "$ReleaseTag^{commit}").Trim()
  if ($LASTEXITCODE -ne 0 -or $tagCommit -ne $SourceCommit) { throw 'Preview tag does not match source commit' }
  $sourceVersion = (Get-Content -Raw (Join-Path $repo 'package.json') | ConvertFrom-Json).version
  if ($sourceVersion -ne $Version) { throw 'Source version mismatch' }
  $buildHelper = Join-Path $PSScriptRoot 'windows-preview-build.mjs'
  $buildProvenance = & node $buildHelper verify $Version $SourceCommit $ReleaseTag
  if ($LASTEXITCODE -ne 0) { throw 'Clean source and fresh packaged-build evidence failed' }
  $buildProvenance = $buildProvenance | ConvertFrom-Json

  $unpacked = Join-Path $repo 'desktop/release/win-unpacked'
  $installer = Join-Path $repo "desktop/release/Keating-$Version-windows-x64-setup.exe"
  $exe = Join-Path $unpacked 'Keating.exe'
  $asar = Join-Path $unpacked 'resources/app.asar'
  $nitro = Join-Path $unpacked 'resources/nitro/server/index.mjs'
  $offline = Join-Path $unpacked 'resources/offline/keating-offline.exe'
  foreach ($required in @($installer, $exe, $asar, $nitro, $offline)) {
    if (!(Test-Path $required -PathType Leaf) -or (Get-Item $required).Length -eq 0) { throw "Missing packaged file: $required" }
  }
  $nativeFiles = @(Get-ChildItem $unpacked -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.node' })
  if (@($nativeFiles | Where-Object Extension -eq '.node').Count -eq 0) { throw 'No packaged native Node modules found' }
  $signedFiles = @((Get-Item $installer)) + $nativeFiles
  $records = [System.Collections.Generic.List[object]]::new()
  $index = 0
  foreach ($file in $signedFiles) {
    $signature = Get-AuthenticodeSignature -FilePath $file.FullName
    if (!$signature.SignerCertificate -or !$signature.TimeStamperCertificate) { throw "Missing Authenticode signer or timestamp: $($file.FullName)" }
    $signerHash = $signature.SignerCertificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256).ToLowerInvariant()
    if ($signerHash -ne $fingerprint) { throw "Wrong signing identity: $($file.FullName)" }
    $log = Join-Path $temporary "signature-$index.log"
    $output = (& $verifier verify -CAfile $certificatePath -TSA-CAfile $tsaRoots -require-leaf-hash "sha256:$fingerprint" -index 0 -in $file.FullName 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    [System.IO.File]::WriteAllText($log, $output, [System.Text.UTF8Encoding]::new($false))
    $proof = & node $nodeHelper signature $log $exitCode
    if ($LASTEXITCODE -ne 0) { throw "Signature-integrity or timestamp validation failed: $($file.FullName)" }
    $records.Add([ordered]@{
      file = [System.IO.Path]::GetRelativePath((Join-Path $repo 'desktop/release'), $file.FullName).Replace('\', '/')
      sha256 = (Get-FileHash $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      windowsTrustStatus = $signature.Status.ToString()
      certificateSHA256 = $signerHash
      timestampCertificateSHA256 = $signature.TimeStamperCertificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256).ToLowerInvariant()
      integrity = ($proof | ConvertFrom-Json)
    })
    $index++
  }

  $previousElectronMode = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $smokeScript = Join-Path $PSScriptRoot 'verify-windows-runtime.cjs'
    $smoke = Start-Process -FilePath $exe -ArgumentList @("`"$smokeScript`"", "`"$asar`"") -NoNewWindow -PassThru
    if (!$smoke.WaitForExit(60000)) { Stop-Process -Id $smoke.Id -Force; throw 'Packaged Electron runtime verification timed out' }
    if ($smoke.ExitCode -ne 0) { throw 'Packaged Electron native storage/runtime verification failed' }
  } finally { $env:ELECTRON_RUN_AS_NODE = $previousElectronMode }
  $probe = Start-Process -FilePath $offline -ArgumentList '--probe' -NoNewWindow -PassThru
  if (!$probe.WaitForExit(60000)) { Stop-Process -Id $probe.Id -Force; throw 'Packaged offline runtime probe timed out' }
  if ($probe.ExitCode -ne 0) { throw 'Packaged offline runtime probe failed' }

  foreach ($record in $records) {
    $original = Join-Path (Join-Path $repo 'desktop/release') $record.file
    if ((Get-FileHash $original -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.sha256) { throw "Verified binary changed during runtime checks: $original" }
  }
  & node $buildHelper verify $Version $SourceCommit $ReleaseTag | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Source or packaged output changed during verification' }

  $outputDirectory = Join-Path $repo 'desktop/release/selfsigned-preview'
  if (Test-Path $outputDirectory) { throw 'Preview output already exists; refusing to mix or overwrite evidence' }
  New-Item -ItemType Directory $outputDirectory | Out-Null
  $artifactName = "Keating-$Version-windows-x64-selfsigned-setup.exe"
  Copy-Item $installer (Join-Path $outputDirectory $artifactName)
  if ((Get-FileHash (Join-Path $outputDirectory $artifactName) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $records[0].sha256) { throw 'Copied installer differs from verified signature evidence' }
  Copy-Item $certificatePath (Join-Path $outputDirectory 'windows-selfsigned-public.pem')
  $report = [ordered]@{
    version = $Version; sourceCommit = $SourceCommit; releaseTag = $ReleaseTag
    buildProvenance = $buildProvenance
    selfSigned = $true; publisherTrusted = $false
    disclosure = 'Self-signed Windows preview. Cryptographic integrity verification does not establish Windows publisher trust or SmartScreen reputation.'
    certificate = $certificateMetadata
    verifier = @{ version = '2.10'; archiveSHA256 = $archiveSHA256 }
    installer = $artifactName; verifiedFiles = $records.ToArray()
    packagedElectronRuntimeVerified = $true; packagedOfflineProbeVerified = $true
    cleanInstallVerified = $false; trustStoreChanged = $false
  }
  $report | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $outputDirectory 'signing-report.json') -Encoding utf8NoBOM
  $sums = foreach ($asset in (Get-ChildItem $outputDirectory -File | Sort-Object Name)) {
    "$( (Get-FileHash $asset.FullName -Algorithm SHA256).Hash.ToLowerInvariant() )  $($asset.Name)"
  }
  $sums | Set-Content (Join-Path $outputDirectory 'SHA256SUMS') -Encoding utf8NoBOM
  Write-Host "Verified $($records.Count) timestamped signatures and both packaged runtime checks. Preview assets: $outputDirectory"
} finally {
  Remove-Item -Recurse -Force $temporary
}

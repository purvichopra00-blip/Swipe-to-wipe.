$file = 'app/(tabs)/index.tsx'
$lines = Get-Content $file

# Line numbers are 1-indexed in viewer; 0-indexed in array
$returnStart = 1132   # line 1133: '    return ('
$stylesStart = 1415   # line 1416: '    const s = StyleSheet.create({'
$stylesEnd   = 1741   # line 1742: '    });'
$funcClose   = 1742   # line 1743: '}'

$before      = $lines[0..($returnStart - 1)]      # lines before return (
$stylesBlock = $lines[$stylesStart..$stylesEnd]    # const s = ... through });
$returnBlock = $lines[$returnStart..($stylesStart - 1)]  # return ( ... );
$close       = @($lines[$funcClose])               # closing }

$newLines = $before + $stylesBlock + $returnBlock + $close
Set-Content -Path $file -Value $newLines -Encoding UTF8
Write-Host "Done. Total lines: $($newLines.Count)"

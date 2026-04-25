# Fix for index.tsx:
# Move `const s = StyleSheet.create({...})` from inside SwipeScreen()
# to module-level (outside function, at the end of the file).
# This is the correct pattern for React Native StyleSheet usage.

$file = 'app/(tabs)/index.tsx'
$lines = Get-Content $file

# After the PS script move, current structure is:
#  line 1133 (idx 1132): '    const s = StyleSheet.create({'
#  line 1459 (idx 1458): '    });'    <-- end of StyleSheet
#  line 1460 (idx 1459): '    return ('
#  line 1743 (idx 1742): '}'         <-- function close

$stylesStart = 1132   # 0-indexed: 'const s = ...'
$stylesEnd   = 1458   # 0-indexed: '    });'
$returnStart = 1459   # 0-indexed: '    return ('
$funcClose   = 1742   # 0-indexed: '}'

$before      = $lines[0..($stylesStart - 1)]          # before const s
$returnBlock = $lines[$returnStart..($funcClose)]      # return (...); }
$stylesBlock = $lines[$stylesStart..$stylesEnd]        # const s = ...

# Remove leading indentation from styles (they'll be at module level)
$stylesFixed = $stylesBlock | ForEach-Object { $_ -replace '^    ', '' }

$newLines = $before + $returnBlock + @('') + $stylesFixed
Set-Content -Path $file -Value $newLines -Encoding UTF8
Write-Host "Done. Total lines: $($newLines.Count)"

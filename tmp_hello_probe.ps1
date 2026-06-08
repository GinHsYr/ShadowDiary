Write-Output 'begin'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  Add-Type -Language CSharp -ReferencedAssemblies System.Runtime.WindowsRuntime -TypeDefinition @"
using System;
using System.Threading.Tasks;
using Windows.Security.Credentials.UI;
using System.Runtime.InteropServices.WindowsRuntime;
public static class HelloProbe {
  public static string Check() {
    var result = UserConsentVerifier.CheckAvailabilityAsync().AsTask().GetAwaiter().GetResult();
    return result.ToString();
  }
}
"@
  Write-Output ('result=' + [HelloProbe]::Check())
} catch {
  Write-Output ('ERR: ' + $_.Exception.ToString())
}
Write-Output 'end'

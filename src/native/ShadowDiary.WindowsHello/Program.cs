using System.Globalization;
using System.Text.Json;
using Windows.Security.Credentials.UI;

static string ToJson(object payload)
{
    return JsonSerializer.Serialize(payload);
}

static async Task<int> WriteSupportAsync()
{
    try
    {
        var availability = await UserConsentVerifier.CheckAvailabilityAsync();
        Console.WriteLine(
            ToJson(
                new
                {
                    ok = true,
                    availability = availability.ToString(),
                    supported = availability == UserConsentVerifierAvailability.Available
                }
            )
        );
        return 0;
    }
    catch (Exception ex)
    {
        Console.WriteLine(ToJson(new { ok = false, error = ex.Message, supported = false }));
        return 1;
    }
}

static async Task<int> WriteVerificationAsync(string[] args)
{
    if (args.Length < 3)
    {
        Console.WriteLine(ToJson(new { ok = false, error = "missing_arguments" }));
        return 1;
    }

    if (
        !long.TryParse(args[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var hwndValue)
    )
    {
        Console.WriteLine(ToJson(new { ok = false, error = "invalid_hwnd" }));
        return 1;
    }

    var message = args[2];

    try
    {
        var result = await UserConsentVerifierInterop.RequestVerificationForWindowAsync(
            new IntPtr(hwndValue),
            message
        );
        Console.WriteLine(
            ToJson(
                new
                {
                    ok = result == UserConsentVerificationResult.Verified,
                    result = result.ToString()
                }
            )
        );
        return 0;
    }
    catch (Exception ex)
    {
        Console.WriteLine(ToJson(new { ok = false, error = ex.Message }));
        return 1;
    }
}

if (args.Length == 0)
{
    Console.WriteLine(ToJson(new { ok = false, error = "missing_command" }));
    return 1;
}

return args[0] switch
{
    "support" => await WriteSupportAsync(),
    "verify" => await WriteVerificationAsync(args),
    _ => 1
};

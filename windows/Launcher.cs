using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Remote Bridge")]
[assembly: AssemblyDescription("Local launcher for the Remote Bridge Windows preview")]
[assembly: AssemblyVersion("0.6.5.0")]
internal static class Launcher {
    [STAThread]
    private static void Main() {
        string root = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(root, "Open-UI.ps1");
        try {
            if (!File.Exists(script)) throw new FileNotFoundException("Keep RemoteBridge.exe beside Open-UI.ps1.");
            Process.Start(new ProcessStartInfo {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -File \"" + script + "\"",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            });
        } catch (Exception error) {
            MessageBox.Show(error.Message, "Remote Bridge", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}

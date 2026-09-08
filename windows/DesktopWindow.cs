using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

public sealed class DesktopWindow : Form {
    private readonly WebView2 web = new WebView2();
    private bool closing;
    private bool readyToClose;
    private TaskCompletionSource<bool> draftSaved;
    private string draftNonce;
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
    protected override void OnHandleCreated(EventArgs e) {
        base.OnHandleCreated(e);
        // Match the window caption to our fixed dark theme on supported Windows.
        try {
            int dark = 1;
            if (DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int)) != 0)
                DwmSetWindowAttribute(Handle, 19, ref dark, sizeof(int));
        } catch (DllNotFoundException) { } catch (EntryPointNotFoundException) { }
    }
    public DesktopWindow(string address, string data, string version) {
        // Fail before showing a usable app if the required system runtime is absent.
        CoreWebView2Environment.GetAvailableBrowserVersionString();
        Text = "Remote Codex " + version;
        Width = 1440; Height = 960; MinimumSize = new Size(360, 400);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(16, 23, 34);
        web.DefaultBackgroundColor = BackColor;
        web.Dock = DockStyle.Fill;
        Controls.Add(web);
        Shown += async (sender, e) => {
            try {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "desktop-webview"));
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Dark;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.WebMessageReceived += (s, args) => {
                    try { if(args.TryGetWebMessageAsString()==draftNonce && draftSaved!=null)draftSaved.TrySetResult(true); } catch{}
                };
                web.CoreWebView2.NewWindowRequested += (s, args) => {
                    args.Handled = true;
                    OpenExternal(args.Uri);
                };
                web.CoreWebView2.NavigationStarting += (s, args) => {
                    Uri uri;
                    if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out uri) || uri.GetLeftPart(UriPartial.Authority) != address) {
                        args.Cancel = true;
                        OpenExternal(args.Uri);
                    }
                };
                web.Source = new Uri(address + "/?desktop=1&ui=" + version);
            } catch (Exception error) {
                MessageBox.Show(this, "界面启动失败：" + error.Message, "Remote Codex");
                Close();
            }
        };
        FormClosing += async (sender, e) => {
            if (readyToClose) return;
            e.Cancel = true;
            if (closing) return;
            closing = true;
            try {
                if (web.CoreWebView2 != null) {
                    draftNonce="draft-saved-"+Guid.NewGuid().ToString("N");
                    draftSaved=new TaskCompletionSource<bool>();
                    var execution=web.ExecuteScriptAsync("(async()=>{try{await window.remoteCodexSaveDrafts?.()}finally{window.chrome.webview.postMessage('"+draftNonce+"')}})()");
                    execution.ContinueWith(t => {var ignored=t.Exception;draftSaved.TrySetResult(false);},TaskContinuationOptions.OnlyOnFaulted);
                    await Task.WhenAny(draftSaved.Task, Task.Delay(1200));
                }
            } catch { }
            web.Dispose();
            readyToClose=true;
            Close();
        };
    }
    private static void OpenExternal(string value) {
        Uri uri;
        if (Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
            Process.Start(new ProcessStartInfo { FileName = value, UseShellExecute = true });
    }
}

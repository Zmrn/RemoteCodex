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
    private bool exitRequested;
    private bool initialized;
    private bool trayDisposed;
    private Task exitDeadline;
    private readonly NotifyIcon tray = new NotifyIcon();
    private readonly ContextMenuStrip trayMenu = new ContextMenuStrip();
    private static readonly uint showMessage = RegisterWindowMessage("RemoteCodex.ShowDesktop.v1");
    private TaskCompletionSource<bool> draftSaved;
    private string draftNonce;
    private readonly WindowPlacement placement;
    private readonly Timer placementTimer = new Timer { Interval = 400 };
    private bool placementReady;
    private void RememberPlacement() {
        if (!placementReady || placement == null) return;
        placement.Capture(this);
        placementTimer.Stop();
        placementTimer.Start();
    }
    private void SavePlacement() {
        if (!placementReady || placement == null) return;
        placementTimer.Stop();
        placement.Capture(this);
        placement.Save();
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string message);
    protected override void WndProc(ref Message message) {
        if (message.Msg == showMessage) { RestoreWindow(); return; }
        base.WndProc(ref message);
    }
    private void RestoreWindow() {
        if (closing) return;
        Show();
        if (WindowState == FormWindowState.Minimized)
            WindowState = placement.WasMaximized ? FormWindowState.Maximized : FormWindowState.Normal;
        Activate();
    }
    private void EnsureExitDeadline() {
        if (exitDeadline != null) return;
        // Only an actual exit reaches here. The process job cleans our own
        // children if WebView2 disposal stalls; official ChatGPT is outside it.
        exitDeadline = Task.Delay(6000).ContinueWith(task => Environment.Exit(0), TaskScheduler.Default);
    }
    public void RequestExit() { exitRequested = true; EnsureExitDeadline(); Close(); }
    private async Task SaveDrafts() {
        if (web.CoreWebView2 == null || web.IsDisposed) return;
        draftNonce = "draft-saved-" + Guid.NewGuid().ToString("N");
        draftSaved = new TaskCompletionSource<bool>();
        var completion = draftSaved;
        var execution = web.ExecuteScriptAsync("(async()=>{try{await window.remoteCodexSaveDrafts?.()}finally{window.chrome.webview.postMessage('" + draftNonce + "')}})()");
        var observed = execution.ContinueWith(t => { var ignored = t.Exception; completion.TrySetResult(false); }, TaskContinuationOptions.OnlyOnFaulted);
        await Task.WhenAny(completion.Task, Task.Delay(1500));
    }
    protected override void Dispose(bool disposing) {
        if (disposing && !trayDisposed) { SavePlacement(); placementReady = false; placementTimer.Dispose(); }
        if (disposing && !trayDisposed) { trayDisposed = true; tray.Visible = false; tray.Dispose(); trayMenu.Dispose(); }
        base.Dispose(disposing);
    }
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
        placement = new WindowPlacement(data);
        placement.Restore(this);
        placementTimer.Tick += (sender, e) => { placementTimer.Stop(); placement.Save(); };
        Move += (sender, e) => RememberPlacement();
        Resize += (sender, e) => RememberPlacement();
        ResizeEnd += (sender, e) => SavePlacement();
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        tray.Icon = Icon;
        tray.Text = "Remote Codex " + version;
        trayMenu.Items.Add("打开 Remote Codex", null, (sender, e) => RestoreWindow());
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("退出 Remote Codex", null, (sender, e) => RequestExit());
        tray.ContextMenuStrip = trayMenu;
        tray.MouseClick += (sender, e) => { if (e.Button == MouseButtons.Left) RestoreWindow(); };
        tray.Visible = true;
        BackColor = Color.FromArgb(16, 23, 34);
        web.DefaultBackgroundColor = BackColor;
        web.Dock = DockStyle.Fill;
        Controls.Add(web);
        Shown += async (sender, e) => {
            if (initialized) return;
            initialized = true;
            placementReady = true;
            RememberPlacement();
            try {
                var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "desktop-webview"));
                await web.EnsureCoreWebView2Async(environment);
                web.CoreWebView2.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Dark;
                web.CoreWebView2.Settings.IsStatusBarEnabled = false;
                web.CoreWebView2.DownloadStarting += (s, args) => {
                    var deferral = args.GetDeferral();
                    BeginInvoke(new Action(() => {
                    try {
                        using (var save = new SaveFileDialog()) {
                            save.Title = "保存会话附件";
                            save.FileName = Path.GetFileName(args.ResultFilePath);
                            save.Filter = "所有文件 (*.*)|*.*";
                            args.Handled = true;
                            if (save.ShowDialog(this) == DialogResult.OK) args.ResultFilePath = save.FileName;
                            else args.Cancel = true;
                        }
                    } catch { args.Cancel = true; }
                    finally { deferral.Complete(); }
                    }));
                };
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
                if (closing || exitRequested || IsDisposed) return;
                MessageBox.Show(this, "界面启动失败：" + error.Message, "Remote Codex");
                RequestExit();
            }
        };
        FormClosing += async (sender, e) => {
            SavePlacement();
            if (readyToClose) return;
            if (e.CloseReason == CloseReason.UserClosing && !exitRequested) {
                e.Cancel = true;
                Hide();
                try { await SaveDrafts(); } catch { }
                return;
            }
            if (e.CloseReason == CloseReason.WindowsShutDown || e.CloseReason == CloseReason.TaskManagerClosing) {
                readyToClose = true;
                tray.Visible = false;
                return;
            }
            e.Cancel = true;
            if (closing) return;
            closing = true;
            EnsureExitDeadline();
            try {
                await SaveDrafts();
            } catch { }
            web.Dispose();
            tray.Visible = false;
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

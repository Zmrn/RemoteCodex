using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Native cards have their own timer/HTTP client. Hidden WebView timer throttling
// cannot suspend remote monitoring. Closing the process disposes this host.
public sealed class DesktopNotifications : IDisposable {
    readonly Form owner;
    readonly string address;
    readonly Func<Task<string>> context;
    readonly Func<string, Task> open;
    readonly Action<NotificationCard> display;
    readonly Timer timer = new Timer { Interval = 2000 };
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 2097152 };
    readonly Dictionary<string, NotificationCard> cards = new Dictionary<string, NotificationCard>();
    readonly ToolStripMenuItem enabled = new ToolStripMenuItem("其他设备的任务通知") { Checked = true };
    readonly ToolStripMenuItem recover = new ToolStripMenuItem("恢复未发出的通知回复");
    readonly ToolStripMenuItem health = new ToolStripMenuItem("远程通知：等待连接") { Enabled = false };
    string csrf;
    bool polling, disposed;
    public DesktopNotifications(Form owner, string address, ContextMenuStrip menu, Func<Task<string>> context, Func<string, Task> open, Action<NotificationCard> display = null) {
        this.owner = owner; this.address = address; this.context = context; this.open = open;
        this.display = display ?? (card => card.Show());
        menu.Items.Add(enabled); menu.Items.Add(recover); menu.Items.Add(health); menu.Items.Add(new ToolStripSeparator());
        enabled.Click += async (s, e) => { try { await Call("settings", new { enabled = !enabled.Checked }); await Poll(); } catch { health.Text = "通知设置未保存，请稍后重试"; } };
        recover.Click += async (s, e) => { try { await Call("restore", new {}); await Poll(); } catch { health.Text = "回复草稿暂不可读"; } };
        timer.Tick += async (s, e) => await Poll();
    }
    public void Start(string token) {
        if (disposed || !System.Text.RegularExpressions.Regex.IsMatch(token ?? "", "^[a-f0-9]{64}$")) return;
        csrf = token; timer.Start();
    }
    public static string Text(Dictionary<string, object> data, string key) { object value; return data.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : ""; }
    async Task<Dictionary<string, object>> Call(string route, object data) {
        if (csrf == null) throw new InvalidOperationException("界面尚未就绪");
        using (var client = new NotificationWebClient()) {
            client.Encoding = Encoding.UTF8;
            client.Headers["X-Bridge-CSRF"] = csrf; client.Headers["Content-Type"] = "application/json";
            var raw = await client.UploadStringTaskAsync(address + "/api/desktop-notifications/" + route, "POST", json.Serialize(data));
            return json.Deserialize<Dictionary<string, object>>(raw);
        }
    }
    async Task Poll() {
        if (polling || disposed || csrf == null) return;
        polling = true;
        try {
            object viewing = null;
            if (owner.Visible && owner.WindowState != FormWindowState.Minimized && owner.ContainsFocus) {
                try { viewing = json.DeserializeObject(await context()); } catch { }
            }
            var result = await Call("poll", new { viewing });
            if (disposed) return;
            enabled.Checked = Text(result, "enabled") == "True";
            recover.Text = "恢复未发出的通知回复（" + Text(result, "drafts") + "）";
            var storage = result["health"] as Dictionary<string, object>;
            var devices = (result["devices"] as System.Collections.ArrayList ?? new System.Collections.ArrayList()).Cast<Dictionary<string, object>>().ToArray();
            int connected = devices.Count(d => Text(d, "status") == "connected" || Text(d, "status") == "partial");
            health.Text = storage != null && Text(storage, "writable") != "True" ? "通知存储异常，已暂停" :
                !enabled.Checked ? "远程通知已暂停" : "远程通知：" + connected + "/" + devices.Count(d => Text(d, "status") != "local-excluded") + " 台可用（仅 Codex）";
            health.ToolTipText = "目标需更新到 0.10.27；Chat / Work 通知尚未验证";
            var events = (result["events"] as System.Collections.ArrayList ?? new System.Collections.ArrayList()).Cast<Dictionary<string, object>>().ToArray();
            var ids = new HashSet<string>(events.Select(e => Text(e, "id")));
            foreach (var pair in cards.ToArray()) if (!ids.Contains(pair.Key) && !pair.Value.HasInput && !pair.Value.Busy) pair.Value.Close();
            float scale; using (var graphics = owner.CreateGraphics()) scale = graphics.DpiY / 96F;
            int capacity = Math.Max(1, Math.Min(3, (int)((Screen.FromControl(owner).WorkingArea.Height - 24) / (272 * scale))));
            foreach (var item in events) {
                string id = Text(item, "id");
                if (cards.ContainsKey(id) || cards.Count >= capacity) continue;
                var card = new NotificationCard(item,
                    async (route, text) => await Call(route, new { id, text }),
                    async () => await open(json.Serialize(new { agent = Text(item, "agent"), thread = Text(item, "thread"), mode = Text(item, "mode") })));
                cards.Add(id, card);
                card.FormClosed += async (s, e) => { cards.Remove(id); Arrange(); if (!disposed) { try { await Call("dismiss", new { id }); } catch {} } };
                Arrange(); this.display(card);
            }
            Arrange();
        } catch { if (!disposed) health.Text = "远程通知连接中，稍后自动重试"; }
        finally { polling = false; }
    }
    void Arrange() {
        var area = Screen.FromControl(owner).WorkingArea; int y = area.Bottom - 12;
        foreach (var card in cards.Values) { y -= card.Height; card.Location = new Point(area.Right - card.Width - 12, Math.Max(area.Top, y)); y -= 10; }
    }
    public async Task SaveDrafts() { foreach (var card in cards.Values.ToArray()) await card.Save(); }
    public void Dispose() {
        if (disposed) return; disposed = true; timer.Dispose();
        foreach (var card in cards.Values.ToArray()) { card.AllowClose = true; card.Dispose(); } cards.Clear();
    }
    sealed class NotificationWebClient : WebClient {
        protected override WebRequest GetWebRequest(Uri address) { var request = base.GetWebRequest(address); request.Timeout = 30000; return request; }
    }
}

public sealed class NotificationCard : Form {
    [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
    static extern IntPtr SendMessage(IntPtr hwnd, int message, IntPtr wParam, string lParam);
    readonly Func<string, string, Task<Dictionary<string, object>>> action;
    readonly Func<Task> open;
    readonly TextBox reply = new TextBox();
    readonly Label status = new Label();
    readonly Button send = new Button();
    readonly Timer saveTimer = new Timer { Interval = 500 };
    readonly Timer expiry = new Timer { Interval = 20000 };
    Task saves = Task.FromResult(true);
    string savedText;
    public bool Busy { get; private set; }
    public bool HasInput { get { return reply.Text.Length > 0; } }
    public bool AllowClose;
    protected override bool ShowWithoutActivation { get { return true; } }
    public NotificationCard(Dictionary<string, object> item, Func<string, string, Task<Dictionary<string, object>>> action, Func<Task> open) {
        this.action = action; this.open = open;
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
        StartPosition = FormStartPosition.Manual; AutoScaleMode = AutoScaleMode.Dpi; AutoScaleDimensions = new SizeF(96, 96);
        ClientSize = new Size(380, 250); BackColor = Color.FromArgb(23, 32, 47); ForeColor = Color.FromArgb(227, 234, 247);
        Font = new Font("Microsoft YaHei UI", 9F); Padding = new Padding(16);
        Text = "Remote Codex · " + DesktopNotifications.Text(item, "device");
        Controls.Add(new Panel { BackColor = Color.FromArgb(99, 158, 255), Dock = DockStyle.Left, Width = 3 });
        var device = new Label { Text = Text, Location = new Point(18, 12), Size = new Size(310, 20), ForeColor = Color.FromArgb(145, 172, 211), AutoEllipsis = true };
        var close = Button("×", 342, 7, 30); close.Click += async (s, e) => await Dismiss();
        string kind = DesktopNotifications.Text(item, "kind");
        var title = new Label { Text = (kind == "completed" ? "已完成 · " : kind == "failed" ? "遇到问题 · " : kind == "approval" ? "需要审批 · " : "需要回答 · ") + DesktopNotifications.Text(item, "title"), Location = new Point(18, 40), Size = new Size(342, 25), Font = new Font(Font, FontStyle.Bold), AutoEllipsis = true };
        var summary = new Label { Text = DesktopNotifications.Text(item, "summary"), Location = new Point(18, 72), Size = new Size(342, 48), AutoEllipsis = true };
        reply.Location = new Point(18, 127); reply.Size = new Size(342, 27); reply.MaxLength = 20000;
        reply.BackColor = Color.FromArgb(15, 23, 35); reply.ForeColor = ForeColor; reply.BorderStyle = BorderStyle.FixedSingle;
        reply.AccessibleName = "回复此任务";
        reply.HandleCreated += (s, e) => SendMessage(reply.Handle, 0x1501, new IntPtr(1), "回复此任务…");
        bool quick = DesktopNotifications.Text(item, "quickReply") == "True";
        reply.Visible = quick;
        reply.Text = DesktopNotifications.Text(item, "draft"); savedText = reply.Text;
        bool unknown = DesktopNotifications.Text(item, "outcome") != "draft";
        reply.ReadOnly = unknown;
        var view = Button("打开任务", 18, 172, 92); view.Click += async (s, e) => { try { await Save(); await open(); if (!HasInput) { AllowClose = true; Close(); } } catch { status.Text = "暂时无法打开，回复已保留"; } };
        var discard = Button("删除草稿", 121, 172, 90); discard.Visible = HasInput;
        discard.Click += async (s, e) => { if (Busy) return; try { await saves; await action("discard", ""); AllowClose = true; Close(); } catch { status.Text = "草稿尚未删除，请稍后重试"; } };
        send.Text = "回复"; send.Location = new Point(270, 172); send.Size = new Size(90, 30); Style(send); send.Visible = quick; send.Enabled = !unknown && reply.Text.Trim().Length > 0;
        send.Click += async (s, e) => {
            if (Busy || reply.ReadOnly || !send.Enabled) return;
            Busy = true; send.Enabled = false; reply.ReadOnly = true; status.Text = "正在提交…";
            try {
                await Save(); var result = await action("reply", reply.Text);
                string outcome = DesktopNotifications.Text(result, "status");
                if (outcome == "accepted") { AllowClose = true; Close(); return; }
                reply.ReadOnly = outcome != "not-sent";
                status.Text = outcome == "not-sent" ? "任务变化或连接不可用；草稿已保留" : "结果未知；请打开任务核对，勿重复发送";
            } catch { status.Text = "结果尚未确认；原回复已保留，请打开核对"; }
            finally { Busy = false; if (!IsDisposed) send.Enabled = !reply.ReadOnly && reply.Text.Trim().Length > 0; }
        };
        status.Location = new Point(18, 214); status.Size = new Size(345, 28); status.ForeColor = Color.FromArgb(160, 177, 202);
        status.Text = unknown ? "结果未知；请打开任务核对，勿重复发送" : quick ? "仅发送到这条任务 · 关闭会保留草稿" : "打开任务后处理，不会自动审批";
        reply.TextChanged += (s, e) => { saveTimer.Stop(); saveTimer.Start(); expiry.Stop(); discard.Visible = HasInput; send.Enabled = !Busy && !reply.ReadOnly && reply.Text.Trim().Length > 0; };
        saveTimer.Tick += async (s, e) => { saveTimer.Stop(); try { await Save(); } catch { status.Text = "草稿保存失败，请保留此窗口并复制文字"; } };
        expiry.Tick += async (s, e) => { if (!HasInput && !ContainsFocus && !Busy) await Dismiss(); };
        Controls.AddRange(new Control[] { device, close, title, summary, reply, view, discard, send, status });
        FormClosing += async (s, e) => { if (AllowClose) return; e.Cancel = true; if (!Busy) await Dismiss(); };
        FormClosed += (s, e) => { saveTimer.Dispose(); expiry.Dispose(); };
        expiry.Start();
    }
    static void Style(Button b) { b.FlatStyle = FlatStyle.Flat; b.FlatAppearance.BorderColor = Color.FromArgb(55, 74, 101); b.BackColor = Color.FromArgb(32, 48, 72); b.ForeColor = Color.FromArgb(225, 234, 249); b.Cursor = Cursors.Hand; }
    Button Button(string text, int x, int y, int width) { var b = new Button { Text = text, Location = new Point(x, y), Size = new Size(width, 30) }; Style(b); return b; }
    public Task Save() {
        saveTimer.Stop(); string value = reply.Text;
        saves = SaveAfter(saves, value); return saves;
    }
    async Task SaveAfter(Task previous, string value) {
        try { await previous; } catch { }
        if (value == savedText) return;
        await action("draft", value); savedText = value;
    }
    async Task Dismiss() {
        if (Busy || AllowClose || IsDisposed) return;
        try { await Save(); AllowClose = true; Close(); } catch { status.Text = "草稿保存失败，请保留此窗口并复制文字"; }
    }
}

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Threading.Tasks;
using System.Windows.Forms;

public sealed class NotificationCard : Form {
    public const int AutoCloseMilliseconds = 5000;
    readonly Func<string, string, Task<Dictionary<string, object>>> action;
    readonly Func<Task> open;
    readonly Label device = Label("device"), badge = Label("kind"), title = Label("title"), summary = Label("summary"), status = Label("status");
    readonly ReplyTextBox reply = new ReplyTextBox { Name = "reply", BorderStyle = BorderStyle.None, Multiline = true, MaxLength = 20000, AcceptsReturn = true, ScrollBars = ScrollBars.None };
    readonly Panel input = new Panel { Name = "composer", Padding = new Padding(10) };
    readonly CardButton close = new CardButton("×", "close"), view = new CardButton("打开任务", "open"), send = new CardButton("回复", "send"), discard = new CardButton("删除草稿", "discard");
    readonly Timer saveTimer = new Timer { Interval = 500 }, expiry = new Timer { Interval = 100 };
    readonly Stopwatch inactive = new Stopwatch();
    readonly Color background = Color.FromArgb(22, 31, 45), muted = Color.FromArgb(145, 163, 187), ink = Color.FromArgb(231, 238, 248);
    Font smallFont, bodyFont, titleFont;
    Task saves = Task.FromResult(true);
    string savedText;
    bool quick, expanded, dismissing, saveFailed, layoutReady;
    long activity;
    float scale = 1;
    public bool Busy { get; private set; }
    public bool HasInput { get { return reply.Text.Length > 0; } }
    public bool AllowClose;
    protected override bool ShowWithoutActivation { get { return true; } }
    protected override CreateParams CreateParams { get { var p = base.CreateParams; p.ClassStyle |= 0x20000; return p; } }

    public NotificationCard(Dictionary<string, object> item, Func<string, string, Task<Dictionary<string, object>>> action, Func<Task> open) {
        this.action = action; this.open = open;
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; TopMost = true;
        StartPosition = FormStartPosition.Manual; AutoScaleMode = AutoScaleMode.None; DoubleBuffered = true;
        BackColor = background; ForeColor = ink;
        device.Text = DesktopNotifications.Text(item, "device");
        title.Text = DesktopNotifications.Text(item, "title");
        summary.Text = DesktopNotifications.Text(item, "summary");
        string kind = DesktopNotifications.Text(item, "kind");
        badge.Text = kind == "completed" ? "已完成" : kind == "failed" ? "遇到问题" : kind == "approval" ? "需要审批" : "需要回答";
        badge.ForeColor = kind == "failed" ? Color.FromArgb(246, 158, 155) : kind == "approval" ? Color.FromArgb(231, 186, 111) : Color.FromArgb(128, 179, 255);
        device.ForeColor = summary.ForeColor = muted; title.ForeColor = ink;
        status.ForeColor = muted; status.Visible = false;
        Text = "Remote Codex · " + device.Text;
        AccessibleDescription = "5 秒无操作后关闭。未发送回复会保存，可从托盘恢复。";
        quick = DesktopNotifications.Text(item, "quickReply") == "True";
        reply.Text = DesktopNotifications.Text(item, "draft"); savedText = reply.Text;
        reply.ReadOnly = DesktopNotifications.Text(item, "outcome") != "draft";
        expanded = quick && (HasInput || reply.ReadOnly);
        reply.BackColor = input.BackColor = Color.FromArgb(14, 22, 34); reply.ForeColor = ink; reply.Dock = DockStyle.Fill;
        reply.AccessibleName = "回复此任务"; input.Controls.Add(reply);
        send.Primary = true; close.Quiet = discard.Quiet = true;
        Controls.AddRange(new Control[] { device, badge, close, title, summary, input, status, view, discard, send });
        if (reply.ReadOnly) status.Text = "提交结果未知，请打开任务核对。草稿已保留。";
        else if (HasInput) status.Text = "已恢复回复草稿";
        using (var graphics = CreateGraphics()) SetScale(graphics.DpiX / 96F);

        close.Click += async (s, e) => await Dismiss();
        view.Click += async (s, e) => {
            Touch();
            try { await Save(); await open(); await Dismiss(); }
            catch { SetStatus("暂时无法打开任务，回复草稿已保留。", true); Touch(); }
        };
        discard.Click += async (s, e) => {
            if (Busy || dismissing) return; Touch();
            try { await saves; await action("discard", ""); AllowClose = true; Close(); }
            catch { SetStatus("草稿尚未删除，请稍后重试。", true); }
        };
        send.Click += async (s, e) => {
            if (Busy || dismissing || !send.Enabled) return; Touch();
            if (!expanded) { expanded = true; UpdateLayout(); reply.Focus(); return; }
            if (reply.ReadOnly || reply.Text.Trim().Length == 0) return;
            Busy = true; reply.ReadOnly = true; SetStatus("正在发送…", false); UpdateLayout();
            try {
                await Save(); var result = await action("reply", reply.Text);
                string outcome = DesktopNotifications.Text(result, "status");
                if (outcome == "accepted") { AllowClose = true; Close(); return; }
                reply.ReadOnly = outcome != "not-sent";
                SetStatus(outcome == "not-sent" ? "尚未发送，草稿已保留。可打开任务继续编辑。" : "提交结果未知，请打开任务核对，勿重复发送。", true);
            } catch { SetStatus("提交结果尚未确认，请打开任务核对。", true); }
            finally { Busy = false; if (!IsDisposed) { Touch(); UpdateLayout(); } }
        };
        reply.TextChanged += (s, e) => {
            Touch(); saveFailed = false; saveTimer.Stop(); saveTimer.Start();
            SetStatus(HasInput ? "正在保存草稿…" : "", false); UpdateLayout();
        };
        foreach (Control control in Controls) {
            control.MouseDown += (s, e) => Touch(); control.KeyDown += (s, e) => Touch();
        }
        reply.MouseDown += (s, e) => Touch(); reply.KeyDown += (s, e) => Touch(); reply.MouseWheel += (s, e) => Touch();
        reply.CompositionChanged += (s, e) => Touch();
        MouseDown += (s, e) => Touch();
        saveTimer.Tick += async (s, e) => { saveTimer.Stop(); try { await Save(); } catch { SaveError(); } };
        expiry.Tick += async (s, e) => {
            if (IsDisposed || AllowClose) return;
            if (Busy || reply.IsComposing) { inactive.Restart(); return; }
            Invalidate(new Rectangle(0, Height - Px(4), Width, Px(4)));
            // Existing text and focus alone never keep a notification alive.
            if (!saveFailed && inactive.ElapsedMilliseconds >= AutoCloseMilliseconds) await Dismiss();
        };
        Shown += (s, e) => { Touch(); expiry.Start(); };
        FormClosing += async (s, e) => { if (AllowClose) return; e.Cancel = true; if (!Busy) await Dismiss(); };
    }
    static Label Label(string name) { return new Label { Name = name, AutoSize = false, AutoEllipsis = true, UseMnemonic = false }; }
    int Px(float value) { return (int)Math.Round(value * scale); }
    internal void SetScale(float value) {
        scale = Math.Max(0.75F, Math.Min(4, value));
        var oldSmall = smallFont; var oldBody = bodyFont; var oldTitle = titleFont;
        smallFont = new Font("Microsoft YaHei UI", 12 * scale, FontStyle.Regular, GraphicsUnit.Pixel);
        bodyFont = new Font("Microsoft YaHei UI", 13 * scale, FontStyle.Regular, GraphicsUnit.Pixel);
        titleFont = new Font("Microsoft YaHei UI", 17 * scale, FontStyle.Bold, GraphicsUnit.Pixel);
        device.Font = badge.Font = status.Font = smallFont; summary.Font = reply.Font = bodyFont; title.Font = titleFont;
        foreach (var button in new[] { close, view, send, discard }) { button.Font = bodyFont; button.ScaleFactor = scale; button.BackColor = background; }
        input.Padding = new Padding(Px(12), Px(10), Px(8), Px(10));
        layoutReady = true; UpdateLayout();
        if (oldSmall != null) oldSmall.Dispose(); if (oldBody != null) oldBody.Dispose(); if (oldTitle != null) oldTitle.Dispose();
    }
    int TextHeight(Label label, int width, int min, int max) {
        int measured = TextRenderer.MeasureText(label.Text, label.Font, new Size(width, 10000), TextFormatFlags.WordBreak | TextFormatFlags.TextBoxControl | TextFormatFlags.NoPadding).Height;
        return Math.Max(Px(min), Math.Min(Px(max), measured + Px(2)));
    }
    void UpdateLayout() {
        if (!layoutReady || IsDisposed) return;
        SuspendLayout();
        int width = Px(420), margin = Px(20), content = width - 2 * margin;
        close.SetBounds(width - Px(42), Px(12), Px(28), Px(28));
        int badgeWidth = TextRenderer.MeasureText(badge.Text, smallFont).Width + Px(8);
        badge.SetBounds(close.Left - Px(8) - badgeWidth, Px(17), badgeWidth, Px(22));
        device.SetBounds(margin, Px(17), Math.Max(Px(40), badge.Left - margin - Px(18)), Px(22));
        int y = Px(50), titleHeight = TextHeight(title, content, 24, 48);
        title.SetBounds(margin, y, content, titleHeight); y += titleHeight + Px(8);
        summary.Visible = summary.Text.Length > 0;
        if (summary.Text.Length > 0) { int h = TextHeight(summary, content, 20, 40); summary.SetBounds(margin, y, content, h); y += h; }
        input.Visible = quick && expanded;
        if (quick && expanded) {
            y += Px(16); input.SetBounds(margin, y, content, Px(68)); y += input.Height;
            using (var roundedInput = Rounded(new RectangleF(0, 0, input.Width, input.Height), Px(8))) { var previous = input.Region; input.Region = new Region(roundedInput); if (previous != null) previous.Dispose(); }
        }
        status.Visible = status.Text.Length > 0;
        if (status.Text.Length > 0) { y += Px(8); int h = TextHeight(status, content, 18, 36); status.SetBounds(margin, y, content, h); y += h; }
        y += Px(18);
        send.Visible = quick; send.Text = expanded ? "发送" : "回复";
        send.Enabled = !Busy && !reply.ReadOnly && (!expanded || HasInput && reply.Text.Trim().Length > 0);
        int buttonWidth = Px(84), gap = Px(8), buttonHeight = Px(34);
        send.SetBounds(width - margin - buttonWidth, y, buttonWidth, buttonHeight);
        view.SetBounds(quick ? send.Left - gap - Px(92) : width - margin - Px(92), y, Px(92), buttonHeight);
        discard.Visible = expanded && HasInput; discard.Enabled = !Busy;
        discard.SetBounds(margin - Px(6), y, Px(86), buttonHeight);
        ClientSize = new Size(width, y + buttonHeight + Px(20));
        using (var outline = Rounded(new RectangleF(0, 0, Width, Height), Px(14))) { var previous = Region; Region = new Region(outline); if (previous != null) previous.Dispose(); }
        ResumeLayout(false); Invalidate();
    }
    void SetStatus(string value, bool error) { status.Text = value; status.ForeColor = error ? Color.FromArgb(236, 166, 143) : muted; UpdateLayout(); }
    void Touch() { activity++; inactive.Restart(); }
    void SaveError() { saveFailed = true; SetStatus("草稿未能保存，请保留此窗口并复制文字。", true); }
    public Task Save() { saveTimer.Stop(); saves = SaveAfter(saves, reply.Text); return saves; }
    async Task SaveAfter(Task previous, string value) {
        try { await previous; } catch { }
        if (value == savedText) return;
        await action("draft", value); savedText = value; saveFailed = false;
        if (!IsDisposed && !Busy && !reply.ReadOnly && reply.Text == value) SetStatus(value.Length > 0 ? "草稿已保存" : "", false);
    }
    async Task Dismiss() {
        if (Busy || dismissing || AllowClose || IsDisposed) return;
        dismissing = true;
        long closingActivity = activity;
        try {
            await Save();
            // Saving can yield while the user resumes typing or composing text.
            // Keep the card and its new inactivity window in that case.
            if (IsDisposed || closingActivity != activity || reply.IsComposing) return;
            AllowClose = true; Close();
        }
        catch { if (!IsDisposed) SaveError(); }
        finally { dismissing = false; }
    }
    protected override void WndProc(ref Message message) {
        base.WndProc(ref message);
        if (message.Msg == 0x02E0 && layoutReady) SetScale((message.WParam.ToInt32() & 0xffff) / 96F);
    }
    protected override void OnPaint(PaintEventArgs e) {
        base.OnPaint(e); e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
        using (var edge = Rounded(new RectangleF(0.5F, 0.5F, Width - 1, Height - 1), Px(14)))
        using (var pen = new Pen(Color.FromArgb(45, 60, 81))) e.Graphics.DrawPath(pen, edge);
        if (inactive.IsRunning && !Busy && !saveFailed) {
            float remaining = Math.Max(0, 1 - inactive.ElapsedMilliseconds / (float)AutoCloseMilliseconds);
            using (var brush = new SolidBrush(Color.FromArgb(75, 118, 176))) e.Graphics.FillRectangle(brush, Px(14), Height - Px(2), (Width - Px(28)) * remaining, Px(2));
        }
    }
    internal static GraphicsPath Rounded(RectangleF rect, float radius) {
        var path = new GraphicsPath(); float d = Math.Max(1, radius * 2);
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90); path.AddArc(rect.Right-d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right-d, rect.Bottom-d, d, d, 0, 90); path.AddArc(rect.Left, rect.Bottom-d, d, d, 90, 90); path.CloseFigure(); return path;
    }
    protected override void Dispose(bool disposing) {
        if (disposing) { expiry.Dispose(); saveTimer.Dispose(); }
        base.Dispose(disposing);
        if (disposing) { if (smallFont != null) smallFont.Dispose(); if (bodyFont != null) bodyFont.Dispose(); if (titleFont != null) titleFont.Dispose(); }
    }
    sealed class ReplyTextBox : TextBox {
        public bool IsComposing { get; private set; }
        public event EventHandler CompositionChanged;
        protected override void WndProc(ref Message message) {
            if (message.Msg == 0x010D) IsComposing = true;
            base.WndProc(ref message);
            if (message.Msg == 0x010E) IsComposing = false;
            if (message.Msg == 0x010D || message.Msg == 0x010E) { var changed = CompositionChanged; if (changed != null) changed(this, EventArgs.Empty); }
        }
    }
    sealed class CardButton : Button {
        public bool Primary, Quiet;
        public float ScaleFactor = 1;
        bool hovering;
        public CardButton(string text, string name) { Text = text; Name = name; FlatStyle = FlatStyle.Flat; FlatAppearance.BorderSize = 0; Cursor = Cursors.Hand; UseMnemonic = false; }
        protected override void OnMouseEnter(EventArgs e) { hovering = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hovering = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnPaint(PaintEventArgs e) {
            e.Graphics.Clear(BackColor); e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            var fill = Primary ? (Enabled ? Color.FromArgb(74, 132, 218) : Color.FromArgb(40, 62, 92)) :
                hovering ? Color.FromArgb(43, 57, 77) : Quiet ? BackColor : Color.FromArgb(31, 43, 60);
            using (var shape = Rounded(new RectangleF(0, 0, Width-1, Height-1), 7*ScaleFactor)) using (var brush = new SolidBrush(fill)) e.Graphics.FillPath(brush, shape);
            var ink = Enabled ? (Primary ? Color.White : Color.FromArgb(175, 193, 218)) : Color.FromArgb(98, 120, 148);
            TextRenderer.DrawText(e.Graphics, Text, Font, ClientRectangle, ink, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            if (Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics, Rectangle.Inflate(ClientRectangle,-4,-4), ink, fill);
        }
    }
}

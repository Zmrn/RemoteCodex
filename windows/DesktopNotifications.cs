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
    readonly Dictionary<string, DateTime> dismissed = new Dictionary<string, DateTime>();
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
        recover.Click += async (s, e) => { try {
            var result = await Call("restore", new {});
            object restored;
            if (result.TryGetValue("ids", out restored)) foreach (var id in restored as System.Collections.ArrayList ?? new System.Collections.ArrayList()) dismissed.Remove(Convert.ToString(id));
            await Poll();
        } catch { health.Text = "回复草稿暂不可读"; } };
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
            // Close immediately from the user's perspective. A delayed/failed
            // delivery acknowledgement must never recreate the same popup.
            foreach (var id in dismissed.Where(p => DateTime.UtcNow - p.Value > TimeSpan.FromMinutes(15)).Select(p => p.Key).ToArray()) dismissed.Remove(id);
            var ids = new HashSet<string>(events.Select(e => Text(e, "id")));
            foreach (var pair in cards.ToArray()) if (!ids.Contains(pair.Key) && !pair.Value.HasInput && !pair.Value.Busy) pair.Value.Close();
            float scale; using (var graphics = owner.CreateGraphics()) scale = graphics.DpiY / 96F;
            int capacity = Math.Max(1, Math.Min(3, (int)((Screen.FromControl(owner).WorkingArea.Height - 24) / (360 * scale))));
            foreach (var item in events) {
                string id = Text(item, "id");
                if (cards.ContainsKey(id) || dismissed.ContainsKey(id) || cards.Count >= capacity) continue;
                var card = new NotificationCard(item,
                    async (route, text) => await Call(route, new { id, text }),
                    async () => await open(json.Serialize(new { agent = Text(item, "agent"), thread = Text(item, "thread"), mode = Text(item, "mode") })));
                cards.Add(id, card);
                card.SizeChanged += (s, e) => Arrange();
                card.FormClosed += async (s, e) => { dismissed[id] = DateTime.UtcNow; cards.Remove(id); Arrange(); if (!disposed) { try { await Call("dismiss", new { id }); } catch {} } };
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

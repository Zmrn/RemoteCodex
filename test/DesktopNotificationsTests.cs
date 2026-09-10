using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
class DesktopNotificationsTests {
    static int checks;
    static void Check(bool value, string message) { if (!value) throw new Exception(message); checks++; Console.WriteLine("PASS " + message); }
    static void Pump(int ms) { var until = DateTime.UtcNow.AddMilliseconds(ms); do { Application.DoEvents(); Thread.Sleep(10); } while (DateTime.UtcNow < until); }
    static Dictionary<string, object> Item(bool quick, string draft = "", string outcome = "draft") { return new Dictionary<string, object> { {"id", new string('a',64)}, {"device", "公司的电脑"}, {"title", "完善 Remote Codex 通知"}, {"kind", "completed"}, {"summary", "已完成远程通知功能。所有设备持续监听，点击可查看对应任务。"}, {"quickReply", quick}, {"draft",draft}, {"outcome",outcome} }; }
    [STAThread] static int Main(string[] args) {
        try {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            var calls = new List<string>(); string saved = null; int opened = 0;
            Func<string,string,Task<Dictionary<string,object>>> action = (route,text) => { calls.Add(route); if(route == "draft") saved=text; return Task.FromResult(new Dictionary<string,object> { {"status","not-sent"} }); };
            using (var card = new NotificationCard(Item(true), action, () => {opened++;return Task.FromResult(true);})) {
                var handle = card.Handle;
                var input = card.Controls.OfType<TextBox>().Single();
                input.Text = "补充一条测试回复"; Pump(650);
                Check(saved == input.Text, "debounced native reply is saved without dispatch"); Check(!calls.Contains("reply"), "typing never sends");
                card.Location = new Point(Screen.PrimaryScreen.WorkingArea.Right-card.Width-12,Screen.PrimaryScreen.WorkingArea.Bottom-card.Height-12);
                card.Show(); Pump(100);
                using (var bitmap = new Bitmap(card.Width,card.Height)) { card.DrawToBitmap(bitmap,card.ClientRectangle); bitmap.Save(Path.Combine(args[1],"notification-card.png")); }
                card.Hide();
                // PerformClick on hidden controls does not dispatch; invoke the
                // production click event through Button.OnClick for a headless form.
                Click(card,"回复"); Pump(150);
                Check(calls.Count(x=>x=="reply")==1 && !input.ReadOnly && !card.IsDisposed, "fresh rejection keeps editable reply in its original card");
                Click(card,"打开任务"); Pump(100); Check(opened==1 && input.Text==saved,"navigation preserves draft");
                input.Text=""; var saving=card.Save(); Pump(100); saving.GetAwaiter().GetResult(); Check(saved=="","clearing text removes unsent reply");
                card.AllowClose=true;
            }
            using (var card = new NotificationCard(Item(true,"保留的测试回复","outcome-unknown"),action,()=>Task.FromResult(true))) {
                var input=card.Controls.OfType<TextBox>().Single(); Check(input.ReadOnly,"unknown result is read-only and cannot be resent");
                Check(!card.Controls.OfType<Button>().Single(b=>b.Text=="回复").Enabled,"unknown result disables quick reply"); card.AllowClose=true;
            }
            using (var card = new NotificationCard(Item(false),action,()=>Task.FromResult(true))) {
                Check(!card.Controls.OfType<TextBox>().Single().Visible,"structured requests have no quick-reply input"); card.AllowClose=true;
            }
            int displayed=0;
            using(var owner=new Form()) using(var menu=new ContextMenuStrip()) using(var host=new DesktopNotifications(owner,args[0],menu,()=>Task.FromResult("null"),text=>Task.FromResult(true),card=>{displayed++;var handle=card.Handle;})) {
                var handle=owner.Handle; host.Start(new string('b',64)); Pump(2500);
                Check(!owner.Visible && displayed==1,"native HTTP timer displays remote event while main window is hidden");
                Pump(2200);Check(displayed==1,"repeated polling does not duplicate the card");
                host.Dispose(); Pump(2200); Check(displayed==1,"disposing native host stops notifications");
            }
            Console.WriteLine("Native notification checks: "+checks); return 0;
        }catch(Exception e){Console.Error.WriteLine(e);return 1;}
    }
    static void Click(Form card,string text) { var button=card.Controls.OfType<Button>().Single(b=>b.Text==text);typeof(Button).GetMethod("OnClick",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).Invoke(button,new object[]{EventArgs.Empty}); }
}

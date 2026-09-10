using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
class DesktopNotificationsTests {
    [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
    static int checks;
    static void Check(bool value, string message) { if (!value) throw new Exception(message); checks++; Console.WriteLine("PASS " + message); }
    static void Pump(int ms) { var until = Stopwatch.StartNew(); do { Application.DoEvents(); Thread.Sleep(10); } while (until.ElapsedMilliseconds < ms); }
    static void PumpUntil(Func<bool> ready, int timeoutMs) { var elapsed = Stopwatch.StartNew(); while (!ready() && elapsed.ElapsedMilliseconds < timeoutMs) Pump(20); }
    static IEnumerable<Control> All(Control c) { foreach(Control child in c.Controls) { yield return child; foreach(var next in All(child))yield return next; } }
    static TextBox Input(Form card) { return All(card).OfType<TextBox>().Single(); }
    static Button Button(Form card,string name) { return All(card).OfType<Button>().Single(b=>b.Name==name); }
    static void Click(Form card,string name) { typeof(Button).GetMethod("OnClick",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Instance).Invoke(Button(card,name),new object[]{EventArgs.Empty}); }
    static Dictionary<string, object> Item(bool quick, string draft = "", string outcome = "draft") { return new Dictionary<string, object> { {"id", new string('a',64)}, {"device", "公司的电脑"}, {"title", "完善 Remote Codex 通知"}, {"kind", "completed"}, {"summary", "已完成远程通知功能。所有设备持续监听，点击可查看对应任务。"}, {"quickReply", quick}, {"draft",draft}, {"outcome",outcome} }; }
    static void ShowBriefly(NotificationCard card) { card.Location=new Point(Screen.PrimaryScreen.WorkingArea.Right-card.Width-12,Screen.PrimaryScreen.WorkingArea.Bottom-card.Height-12); card.Show(); Application.DoEvents(); card.Hide(); }
    static void Capture(NotificationCard card,string file,float scale) {
        card.Show(); card.SetScale(scale); Application.DoEvents();
        var controls=card.Controls.Cast<Control>().Where(c=>c.Visible).ToArray();
        Check(controls.All(c=>c.Left>=0&&c.Top>=0&&c.Right<=card.ClientSize.Width&&c.Bottom<=card.ClientSize.Height),scale+"x controls remain inside card");
        var overlaps=new List<string>();for(int i=0;i<controls.Length;i++)for(int j=i+1;j<controls.Length;j++)if(controls[i].Bounds.IntersectsWith(controls[j].Bounds))overlaps.Add(controls[i].Name+"/"+controls[j].Name);
        Check(overlaps.Count==0,scale+"x controls do not overlap "+string.Join(",",overlaps));
        using(var bitmap=new Bitmap(card.Width,card.Height)){card.DrawToBitmap(bitmap,card.ClientRectangle);bitmap.Save(file);}
        card.Hide();
    }
    [STAThread] static int Main(string[] args) {
        try {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            var calls=new List<string>();string saved=null;int opened=0;
            Func<string,string,Task<Dictionary<string,object>>> action=(route,text)=>{calls.Add(route);if(route=="draft")saved=text;return Task.FromResult(new Dictionary<string,object>{{"status","not-sent"}});};
            using(var card=new NotificationCard(Item(true),action,()=>{opened++;return Task.FromResult(true);})){
                ShowBriefly(card); Check(card.Height<230,"compact notification has no persistent input area");
                foreach(float scale in new[]{1F,1.25F,1.5F,2F})Capture(card,Path.Combine(args[1],"notification-compact-"+scale+".png"),scale);
                card.SetScale(1);Click(card,"send");Check(Button(card,"send").Text=="发送","reply opens an inline composer first");
                Input(card).Text="补充一条测试回复";Pump(650);
                Check(saved==Input(card).Text,"native reply autosaves without dispatch");Check(!calls.Contains("reply"),"typing never sends");
                Capture(card,Path.Combine(args[1],"notification-reply.png"),1);
                Click(card,"send");Pump(100);Check(calls.Count(x=>x=="reply")==1&&!Input(card).ReadOnly,"confirmed rejection keeps reply editable");
                Input(card).Text="";var saving=card.Save();Pump(100);saving.GetAwaiter().GetResult();Check(saved=="","clearing the composer deletes unsent text");
                Click(card,"open");Pump(100);Check(opened==1&&card.IsDisposed,"open navigates once and closes the card");
            }
            using(var card=new NotificationCard(Item(true,"保留的测试回复","outcome-unknown"),action,()=>Task.FromResult(true))){
                var item=card.Controls.Find("title",false).Single();item.Text="这是较长的任务标题，用于验证两行标题和双倍缩放时不会挤压摘要或者操作按钮";
                Capture(card,Path.Combine(args[1],"notification-unknown-2.png"),2);
                Check(Input(card).ReadOnly&&!Button(card,"send").Enabled,"unknown submission remains protected");card.AllowClose=true;
            }
            using(var card=new NotificationCard(Item(false),action,()=>Task.FromResult(true))){
                card.Show();Check(!Input(card).Visible&&!Button(card,"send").Visible,"structured request shows only open action");
                Capture(card,Path.Combine(args[1],"notification-question.png"),1);card.AllowClose=true;
            }
            var timed=new List<NotificationCard>();bool failSave=true;
            try{
                var plain=new NotificationCard(Item(false),action,()=>Task.FromResult(true));timed.Add(plain);
                var draft=new NotificationCard(Item(true,"已经保存的草稿"),action,()=>Task.FromResult(true));timed.Add(draft);
                var cleared=new NotificationCard(Item(true),action,()=>Task.FromResult(true));timed.Add(cleared);
                var editing=new NotificationCard(Item(true),action,()=>Task.FromResult(true));timed.Add(editing);
                var composing=new NotificationCard(Item(true),action,()=>Task.FromResult(true));timed.Add(composing);
                var failed=new NotificationCard(Item(true), (route,text)=>{if(failSave&&route=="draft")throw new IOException("isolated disk failure");return action(route,text);},()=>Task.FromResult(true));timed.Add(failed);
                foreach(var card in timed)ShowBriefly(card);
                Click(cleared,"send");Input(cleared).Text="稍后清空";Input(cleared).Text="";
                Click(editing,"send");Input(editing).Text="正在编辑";
                Click(composing,"send");SendMessage(Input(composing).Handle,0x010D,IntPtr.Zero,IntPtr.Zero);
                Click(failed,"send");Input(failed).Text="保存失败时保留的文字";
                Pump(3100);Check(!plain.IsDisposed,"notification remains before five seconds");
                Input(editing).AppendText("，继续输入");Pump(2350);
                Check(plain.IsDisposed,"default card closes after five seconds");
                Check(draft.IsDisposed,"saved draft does not pin the popup indefinitely");
                Check(cleared.IsDisposed,"typing then clearing still permits timed dismissal");
                Check(!editing.IsDisposed,"typing restarts the five-second inactivity timer");
                Check(!composing.IsDisposed,"IME composition is not dismissed before text is committed");
                SendMessage(Input(composing).Handle,0x010E,IntPtr.Zero,IntPtr.Zero);
                Check(!failed.IsDisposed&&Input(failed).Text.Length>0,"failed draft save prevents destructive dismissal");
                failSave=false;Click(failed,"close");Pump(100);Check(failed.IsDisposed,"manual close retries and saves the protected draft");
                Pump(2850);Check(editing.IsDisposed,"stopping input closes popup and retains the saved draft");
                Check(!composing.IsDisposed,"IME completion restarts the inactivity window");Pump(2400);Check(composing.IsDisposed,"notification expires after composition finishes");
            }finally{foreach(var card in timed){card.AllowClose=true;card.Dispose();}}
            var pendingSave = new TaskCompletionSource<Dictionary<string, object>>();
            string latestSaved = null;
            using (var card = new NotificationCard(Item(true), async (route, text) => {
                if (route == "draft" && text == "原草稿") await pendingSave.Task;
                if (route == "draft") latestSaved = text;
                return new Dictionary<string, object>();
            }, () => Task.FromResult(true))) {
                ShowBriefly(card); Click(card, "send"); Input(card).Text = "原草稿";
                Pump(5300); Input(card).AppendText("，保存等待期间的新文字");
                pendingSave.SetResult(new Dictionary<string, object>()); Pump(700);
                Check(!card.IsDisposed, "typing during delayed expiry save keeps the card open");
                Check(latestSaved == Input(card).Text, "new text during expiry save is persisted before closing");
                Pump(4600); Check(card.IsDisposed, "delayed save still allows closure after the new inactivity window");
            }
            int displayed=0;
            // The poll interval is already 2 seconds. Wait for its HTTP result,
            // not a 500ms allowance for a cold WebClient on shared CI runners.
            using(var owner=new Form())using(var menu=new ContextMenuStrip())using(var host=new DesktopNotifications(owner,args[0],menu,()=>Task.FromResult("null"),text=>Task.FromResult(true),card=>{displayed++;ShowBriefly(card);})){var handle=owner.Handle;host.Start(new string('b',64));PumpUntil(()=>displayed>0,8000);
                Check(!owner.Visible&&displayed==1,"hidden main window still receives notification");
                Pump(7900);Check(displayed==1,"failed dismiss acknowledgement and repeated poll never resurrect expired popup");
                menu.Items.OfType<ToolStripMenuItem>().Single(i=>i.Text.StartsWith("恢复未发出")).PerformClick();PumpUntil(()=>displayed>1,8000);
                Check(displayed==2,"explicit recovery reopens only the returned draft IDs");
                host.Dispose();Pump(2200);Check(displayed==2,"disposing host stops notifications");
            }
            Console.WriteLine("Native notification checks: "+checks);return 0;
        }catch(Exception e){Console.Error.WriteLine(e);return 1;}
    }
}

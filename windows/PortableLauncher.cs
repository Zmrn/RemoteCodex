using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Remote Codex")]
[assembly: AssemblyDescription("Self-contained Windows desktop bridge launcher")]

internal static class PortableLauncher {
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static string home;
    private static string data;
    private static bool quiet;

    [STAThread]
    private static int Main(string[] args) {
        quiet = Array.IndexOf(args, "--headless") >= 0;
        try {
            var options = Parse(args);
            home = Path.GetFullPath(options.ContainsKey("--home") ? options["--home"] :
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RemoteCodex"));
            data = Path.Combine(home, "data");
            EnsureDirectory(home); EnsureDirectory(data);
            if (options.ContainsKey("--stop")) { Stop(ReadRecord()); return 0; }
            // Compatibility with the 0.8 updater: the short-lived invocation
            // now starts an owned, visible desktop, never an orphan service.
            if (quiet && !options.ContainsKey("--self-test") && !options.ContainsKey("--prepare-only"))
                return LaunchCompatibility(options);
            if (options.ContainsKey("--prepare-only")) { Extract(); return 0; }
            if (options.ContainsKey("--self-test")) {
                string root = Extract();
                OwnedProcesses.BindLifetime();
                using (Process check = RunNode(root, "src/portable-check.mjs", new List<string>(), Guid.NewGuid().ToString())) {
                    if (!check.WaitForExit(60000)) throw new Exception("只读自检超时。");
                    return check.ExitCode;
                }
            }
            return RunSingleDesktop(options);
        } catch (Exception error) {
            try { if (data != null) File.WriteAllText(Path.Combine(data, "launcher-error.txt"), error.ToString(), Encoding.UTF8); } catch { }
            if (!quiet) MessageBox.Show(error.Message, "Remote Codex", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static int LaunchCompatibility(Dictionary<string,string> options) {
        if(FocusExistingDesktop())return 0;
        string arguments = "";
        foreach (var item in options) if (item.Key != "--headless") arguments += " " + item.Key + " " + Quote(item.Value);
        using (Process desktop = Process.Start(new ProcessStartInfo {
            FileName = Assembly.GetExecutingAssembly().Location, Arguments = arguments,
            UseShellExecute = false, WindowStyle = ProcessWindowStyle.Normal
        })) {
            for (int i=0;i<360;i++) {
                var owner = ReadDesktopRecord();
                if (DesktopAlive(owner) && Text(owner,"version") == PortableBuild.Version && IsRunning(ReadRecord())) return 0;
                if (desktop.HasExited && desktop.ExitCode != 0) throw new Exception("桌面启动失败，请查看 launcher-error.txt。");
                Thread.Sleep(250);
            }
            throw new Exception("桌面启动超时。");
        }
    }

    private static int RunDesktop(string root, Dictionary<string,string> options) {
        Dictionary<string,object> record = null;
        Form window = null;
        bool updating = false;
        string helperJob = null;
        string ownerFile = Path.Combine(data,"desktop.json");
        try {
            string mutexName = "Local\\RemoteCodex-" + Hash(Encoding.UTF8.GetBytes(home.ToLowerInvariant())).Substring(0,24);
            using (Mutex mutex = new Mutex(false,mutexName)) {
                bool locked=false;
                try {
                    try { locked=mutex.WaitOne(30000); } catch(AbandonedMutexException) { locked=true; }
                    if (!locked) throw new Exception("上一个桌面启动或退出尚未结束，请稍后再试。");
                    var owner=ReadDesktopRecord();
                    if (DesktopAlive(owner) && Text(owner,"version")==PortableBuild.Version) {
                        IntPtr handle = new IntPtr(Convert.ToInt64(owner["window"]));
                        OwnedProcesses.ShowWindow(handle,9); OwnedProcesses.SetForegroundWindow(handle);
                        return 0;
                    }
                    var old=ReadRecord();
                    Stop(old); // API instance ID + cached runtime path must both match.
                    for(int i=0;i<100 && DesktopAlive(owner);i++) Thread.Sleep(100);
                    if(DesktopAlive(owner)) throw new Exception("旧窗口尚未退出；请关闭旧窗口后重试。");
                    CloseLegacyBrowser();
                    OwnedProcesses.BindLifetime();
                    Application.EnableVisualStyles();
                    Application.SetCompatibleTextRenderingDefault(false);
                    string instance=Guid.NewGuid().ToString();
                    var nodeArgs=new List<string> {"--port",options.ContainsKey("--port")?options["--port"]:ReusablePort(old)};
                    AddOption(options,nodeArgs,"--agent-address"); AddOption(options,nodeArgs,"--agent-port");
                    using(Process server=RunNode(root,"src/server.mjs",nodeArgs,instance)) {
                        for(int i=0;i<240;i++) {
                            if(server.HasExited) throw new Exception("桥接启动失败，请查看 startup-error.txt。");
                            var candidate=ReadRecord();
                            if(candidate!=null && Text(candidate,"instanceId")==instance && IsRunning(candidate)) {record=candidate;break;}
                            Thread.Sleep(250);
                        }
                        if(record==null) throw new Exception("桥接启动超时。");
                    }
                    string sdk=Path.Combine(root,"runtime/webview2");
                    if(OwnedProcesses.LoadLibrary(Path.Combine(sdk,"WebView2Loader.dll"))==IntPtr.Zero) throw new Exception("无法加载 WebView2 组件。");
                    var ui=Assembly.LoadFrom(Path.Combine(sdk,"DesktopUi.dll"));
                    window=(Form)Activator.CreateInstance(ui.GetType("DesktopWindow"),new object[]{Text(record,"address"),data,PortableBuild.Version});
                    File.WriteAllText(ownerFile,Json.Serialize(new Dictionary<string,object>{
                        {"pid",Process.GetCurrentProcess().Id},{"executable",Assembly.GetExecutingAssembly().Location},
                        {"version",PortableBuild.Version},{"instanceId",instance},{"window",window.Handle.ToInt64()}
                    }));
                } finally {if(locked)mutex.ReleaseMutex();}
            }
            using(var timer=new System.Windows.Forms.Timer {Interval=400}) {
                timer.Tick += (sender,e) => {
                    if(!OwnedProcessAlive(record)) {window.Close();return;}
                    if(helperJob!=null) {
                        try {
                            var result=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(data,"updates/result.json")));
                            if(Text(result,"jobId")==helperJob && Text(result,"status")!="updated") {helperJob=null;updating=false;}
                        } catch{}
                        return;
                    }
                    string requestFile=Path.Combine(data,"updates/desktop-request.json");
                    if(!File.Exists(requestFile))return;
                    try {
                        var request=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(requestFile));
                        string jobFile=Path.Combine(data,"updates/job.json");
                        var job=Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(jobFile));
                        if(Text(request,"instanceId")!=Text(record,"instanceId") || Text(request,"jobId")!=Text(job,"jobId") ||
                            Text(job,"desktopPid")!=Process.GetCurrentProcess().Id.ToString())return;
                        string node=Path.Combine(root,"runtime/node/node.exe");
                        OwnedProcesses.StartUpdateHelper(node,Quote(node)+" "+Quote(Path.Combine(root,"src/apply-update.mjs"))+" "+Quote(jobFile),root);
                        helperJob=Text(job,"jobId"); updating=true;
                        File.Delete(requestFile);
                    } catch(Exception error) {File.WriteAllText(Path.Combine(data,"update-launch-error.txt"),error.Message);}
                };
                timer.Start();
                Application.Run(window);
            }
            return 0;
        } finally {
            if(window!=null)window.Dispose();
            if(record!=null && !updating) {try{Stop(record);}catch{}}
            try {var owner=ReadDesktopRecord();if(Text(owner,"pid")==Process.GetCurrentProcess().Id.ToString())File.Delete(ownerFile);}catch{}
            // Process exit closes the job and terminates any remaining owned children.
        }
    }
    private static Dictionary<string,object> ReadDesktopRecord() {
        try{return Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(data,"desktop.json")));}catch{return null;}
    }

    private static int RunSingleDesktop(Dictionary<string,string> options) {
        // One visible app per Windows user on this machine, independent of
        // executable copy, version and --home. Keep the mutex for its full life.
        string user=System.Security.Principal.WindowsIdentity.GetCurrent().User.Value;
        using(var mutex=new Mutex(false,"Global\\RemoteCodex-Desktop-"+user)) {
            bool locked=false;
            try {
                for(int attempt=0;attempt<120;attempt++) {
                    try {locked=mutex.WaitOne(0);}catch(AbandonedMutexException){locked=true;}
                    if(locked) {
                        if(FocusExistingDesktop())return 0;
                        return RunDesktop(Extract(),options);
                    }
                    if(FocusExistingDesktop())return 0;
                    Thread.Sleep(250);
                }
                throw new Exception("桌面正在启动或退出，请稍后再试。");
            } finally {if(locked)mutex.ReleaseMutex();}
        }
    }
    private static bool FocusExistingDesktop() {
        int me=Process.GetCurrentProcess().Id, session=Process.GetCurrentProcess().SessionId;
        foreach(var process in Process.GetProcesses())using(process) {
            try {
                if(process.Id==me||process.SessionId!=session||process.MainWindowHandle==IntPtr.Zero)continue;
                var file=process.MainModule.FileVersionInfo;
                if(file.FileDescription!="Remote Codex"||file.Comments!="Self-contained Windows desktop bridge launcher")continue;
                OwnedProcesses.ShowWindow(process.MainWindowHandle,9);
                OwnedProcesses.SetForegroundWindow(process.MainWindowHandle);
                return true;
            }catch{}
        }
        return false;
    }
    private static string ReusablePort(Dictionary<string,object> old) {
        Uri uri;
        if(Text(old,"application")!="remote-codex" || !Uri.TryCreate(Text(old,"address"),UriKind.Absolute,out uri) ||
            uri.Host!="127.0.0.1" || uri.Scheme!="http" || uri.Port<1)return "0";
        var probe=new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback,uri.Port);
        try {probe.Start();return uri.Port.ToString();}catch{return "0";}finally{probe.Stop();}
    }
    private static bool DesktopAlive(Dictionary<string,object> record) {
        try {using(var process=Process.GetProcessById(Convert.ToInt32(record["pid"]))) {
            return !process.HasExited && SamePath(process.MainModule.FileName,Text(record,"executable"));
        }}catch{return false;}
    }
    private static void CloseLegacyBrowser() {
        string profile=Path.Combine(data,"windows-ui-profile");
        // Match only our old dedicated Edge profile; never touch the user's Edge
        // browser or the official ChatGPT process.
        using(var query=new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='msedge.exe'"))
        foreach(ManagementObject item in query.Get()) {
            string command=Convert.ToString(item["CommandLine"]);
            if(command.IndexOf("--user-data-dir="+Quote(profile),StringComparison.OrdinalIgnoreCase)<0 &&
               command.IndexOf(Quote("--user-data-dir="+profile),StringComparison.OrdinalIgnoreCase)<0)continue;
            try {using(var process=Process.GetProcessById(Convert.ToInt32(item["ProcessId"]))) {
                process.CloseMainWindow();if(!process.WaitForExit(3000))process.Kill();
            }}catch{}
        }
    }

    private static Dictionary<string, string> Parse(string[] args) {
        var result = new Dictionary<string, string>();
        for (int i = 0; i < args.Length; i++) {
            string key = args[i];
            if (result.ContainsKey(key)) throw new Exception("重复参数：" + key);
            if (key == "--headless" || key == "--stop" || key == "--self-test" || key == "--prepare-only") result[key] = "true";
            else if (key == "--home" || key == "--port" || key == "--agent-address" || key == "--agent-port") {
                if (++i >= args.Length) throw new Exception("缺少参数值：" + key);
                result[key] = args[i];
            } else throw new Exception("未知参数：" + key);
        }
        foreach (string key in new[] { "--port", "--agent-port" }) {
            int port;
            if (result.ContainsKey(key) && (!Int32.TryParse(result[key], out port) || port < (key == "--port" ? 0 : 1) || port > 65535))
                throw new Exception("端口参数无效：" + key);
        }
        if (result.ContainsKey("--stop") && result.ContainsKey("--self-test")) throw new Exception("--stop 与 --self-test 不能同时使用。");
        return result;
    }

    private static void AddOption(Dictionary<string, string> options, List<string> arguments, string key) {
        if (options.ContainsKey(key)) { arguments.Add(key); arguments.Add(options[key]); }
    }

    private static string Hash(byte[] bytes) {
        using (SHA256 sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    }
    private static string HashFile(string file) {
        using (SHA256 sha = SHA256.Create())
        using (Stream stream = File.OpenRead(file)) { return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant(); }
    }
    private static void EnsureDirectory(string folder) {
        for (DirectoryInfo current = new DirectoryInfo(folder); current != null; current = current.Parent) {
            if (current.Exists && (current.Attributes & FileAttributes.ReparsePoint) != 0) throw new Exception("程序缓存目录不能使用目录链接：" + folder);
        }
        Directory.CreateDirectory(folder);
    }
    private static string Inside(string root, string name) {
        string target = Path.GetFullPath(Path.Combine(root, name.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new Exception("压缩包包含越界路径。");
        return target;
    }
    private static string ResourceText(string name) {
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) { return reader.ReadToEnd(); }
    }
    private static void VerifyFiles(string root) {
        foreach (string line in ResourceText("payload.files").Split('\n')) {
            if (String.IsNullOrWhiteSpace(line)) continue;
            string[] fields = line.TrimEnd('\r').Split('\t');
            string file = Inside(root, fields[1]);
            EnsureDirectory(Path.GetDirectoryName(file));
            if (!File.Exists(file) || (File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0 || HashFile(file) != fields[0])
                throw new Exception("程序缓存校验失败，请停止桥接器后移除版本缓存再重新打开：" + root);
        }
    }
    private static string Extract() {
        string versions = Path.Combine(home, "versions");
        EnsureDirectory(versions);
        string root = Path.Combine(versions, PortableBuild.Version + "-" + PortableBuild.PayloadHash.Substring(0, 12));
        if (Directory.Exists(root)) { VerifyFiles(root); return root; }
        string staging = Path.Combine(versions, ".extract-" + Guid.NewGuid().ToString("N"));
        EnsureDirectory(staging);
        using (Stream stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) {
            using (SHA256 sha = SHA256.Create()) {
                string hash = BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                if (hash != PortableBuild.PayloadHash) throw new Exception("EXE 内置资源校验失败，请重新复制完整文件。");
            }
            stream.Position = 0;
            using (ZipArchive zip = new ZipArchive(stream, ZipArchiveMode.Read)) {
                foreach (ZipArchiveEntry entry in zip.Entries) {
                    string target = Inside(staging, entry.FullName);
                    if (entry.FullName.EndsWith("/")) { EnsureDirectory(target); continue; }
                    EnsureDirectory(Path.GetDirectoryName(target));
                    using (Stream input = entry.Open())
                    using (Stream output = new FileStream(target, FileMode.CreateNew, FileAccess.Write)) { input.CopyTo(output); }
                }
            }
        }
        VerifyFiles(staging);
        // Windows scanners can briefly hold newly extracted runtime DLLs open.
        // Retry only this private staging rename; never overwrite another version.
        for (int attempt = 0; ; attempt++) {
            try { Directory.Move(staging, root); break; }
            catch (IOException) { if (attempt >= 29) throw; }
            catch (UnauthorizedAccessException) { if (attempt >= 29) throw; }
            Thread.Sleep(200);
        }
        return root;
    }

    // Windows command-line quoting; paths with spaces, Unicode and trailing slashes remain intact.
    private static string Quote(string value) {
        if (value.IndexOf('\0') >= 0) throw new Exception("参数包含无效字符。");
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1);
            else result.Append('\\', slashes);
            result.Append(character);
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }

    private static Process RunNode(string root, string script, List<string> arguments, string instance) {
        string line = Quote(Path.Combine(root, script));
        foreach (string argument in arguments) line += " " + Quote(argument);
        var info = new ProcessStartInfo {
            FileName = Path.Combine(root, "runtime/node/node.exe"), Arguments = line,
            WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden
        };
        info.EnvironmentVariables["REMOTE_BRIDGE_DATA_DIR"] = data;
        info.EnvironmentVariables["REMOTE_BRIDGE_PYTHON"] = Path.Combine(root, "runtime/python/python.exe");
        info.EnvironmentVariables["REMOTE_BRIDGE_INSTANCE_ID"] = instance;
        info.EnvironmentVariables["REMOTE_BRIDGE_PORTABLE"] = "1";
        info.EnvironmentVariables["REMOTE_BRIDGE_HOME"] = home;
        info.EnvironmentVariables["REMOTE_BRIDGE_DESKTOP_PID"] = Process.GetCurrentProcess().Id.ToString();
        info.EnvironmentVariables["REMOTE_BRIDGE_LAUNCHER_EXE"] = Assembly.GetExecutingAssembly().Location;
        foreach (string key in new[] { "NODE_OPTIONS", "NODE_PATH", "PYTHONHOME", "PYTHONPATH" }) info.EnvironmentVariables.Remove(key);
        return Process.Start(info);
    }
    private static string Text(Dictionary<string, object> value, string key) {
        return value != null && value.ContainsKey(key) ? Convert.ToString(value[key]) : "";
    }
    private static bool SamePath(string a, string b) {
        return String.Equals(Path.GetFullPath(a), Path.GetFullPath(b), StringComparison.OrdinalIgnoreCase);
    }
    private static Dictionary<string, object> ReadRecord() {
        try { return Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(data, "server.json"))); }
        catch { return null; }
    }
    private static string Request(string address, string route, string csrf, bool post) {
        Uri uri;
        if (!Uri.TryCreate(address, UriKind.Absolute, out uri) || uri.Scheme != "http" || uri.Host != "127.0.0.1" || uri.AbsolutePath != "/")
            throw new Exception("桥接地址不是本机回环地址。");
        var request = (System.Net.HttpWebRequest)System.Net.WebRequest.Create(address.TrimEnd('/') + route);
        request.Proxy = null;
        request.AllowAutoRedirect = false;
        request.Timeout = 2000;
        request.ReadWriteTimeout = 2000;
        if (csrf != null) request.Headers["X-Bridge-CSRF"] = csrf;
        if (post) {
            request.Method = "POST"; request.ContentType = "application/json"; request.ContentLength = 2;
            using (Stream stream = request.GetRequestStream()) { byte[] bytes = Encoding.UTF8.GetBytes("{}"); stream.Write(bytes, 0, bytes.Length); }
        }
        using (var response = request.GetResponse())
        using (StreamReader reader = new StreamReader(response.GetResponseStream())) { return reader.ReadToEnd(); }
    }
    private static string Csrf(string address) {
        Match match = Regex.Match(Request(address, "/", null, false), "name=\"bridge-csrf\" content=\"([a-f0-9]+)\"");
        if (!match.Success) throw new Exception("不是预期的桥接页面。");
        return match.Groups[1].Value;
    }
    private static bool OwnedProcessAlive(Dictionary<string, object> record) {
        try {
            if (Text(record, "application") != "remote-codex" || Text(record, "portable") != "True") return false;
            string executable = Text(record, "executable");
            if (!Path.GetFullPath(executable).StartsWith(Path.GetFullPath(Path.Combine(home, "versions")) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return false;
            using (Process process = Process.GetProcessById(Convert.ToInt32(record["pid"]))) {
                if (process.HasExited || !SamePath(process.MainModule.FileName, executable)) return false;
            }
            return true;
        } catch { return false; }
    }
    private static bool IsRunning(Dictionary<string, object> record) {
        try {
            if (!OwnedProcessAlive(record)) return false;
            string address = Text(record, "address");
            var actual = Json.Deserialize<Dictionary<string, object>>(Request(address, "/api/instance", Csrf(address), false));
            return Text(actual, "instanceId") == Text(record, "instanceId") && Text(actual, "pid") == Text(record, "pid");
        } catch { return false; }
    }
    private static void Stop(Dictionary<string, object> record) {
        if (!IsRunning(record)) {
            if (OwnedProcessAlive(record)) throw new Exception("无法确认现有桥接器的实例身份，未停止任何进程。");
            return;
        }
        string address = Text(record, "address");
        Request(address, "/api/stop", Csrf(address), true);
        for (int attempt = 0; attempt < 100 && OwnedProcessAlive(record); attempt++) Thread.Sleep(100);
        if (OwnedProcessAlive(record)) throw new Exception("桥接器尚未停止，请稍后重试。没有结束任何官方进程。");
    }
}

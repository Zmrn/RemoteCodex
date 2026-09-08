using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
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
            Dictionary<string, string> options = Parse(args);
            quiet = options.ContainsKey("--headless");
            home = Path.GetFullPath(options.ContainsKey("--home") ? options["--home"] :
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RemoteCodex"));
            data = Path.Combine(home, "data");
            EnsureDirectory(home);
            EnsureDirectory(data);
            string mutexName = "Local\\RemoteCodex-" + Hash(Encoding.UTF8.GetBytes(home.ToLowerInvariant())).Substring(0, 24);
            using (Mutex mutex = new Mutex(false, mutexName)) {
                bool locked = false;
                try {
                    try { locked = mutex.WaitOne(30000); } catch (AbandonedMutexException) { locked = true; }
                    if (!locked) throw new Exception("另一个启动操作尚未结束，请稍后重试。");
                    if (options.ContainsKey("--stop")) {
                        Stop(ReadRecord());
                        return 0;
                    }
                    if (!Environment.Is64BitOperatingSystem) throw new Exception("此版本需要 64 位 Windows。");
                    string root = Extract();
                    if (options.ContainsKey("--self-test")) {
                        using (Process check = RunNode(root, "src/portable-check.mjs", new List<string>(), Guid.NewGuid().ToString())) {
                            if (!check.WaitForExit(60000)) {
                                check.Kill();
                                throw new Exception("只读自检超时。官方任务未被中断。");
                            }
                            if (!quiet) MessageBox.Show("自检结果：" + Path.Combine(data, "self-test.json"), "Remote Codex");
                            return check.ExitCode;
                        }
                    }
                    Dictionary<string, object> record = ReadRecord();
                    if (IsRunning(record)) {
                        string expected = Path.Combine(root, "runtime/node/node.exe");
                        if (!SamePath(Text(record, "executable"), expected))
                            throw new Exception("旧版桥接器仍在运行。请先用此 EXE 加 --stop 停止桥接器，再打开新版。官方任务会继续运行。");
                        if (options.ContainsKey("--agent-address") || options.ContainsKey("--port"))
                            throw new Exception("桥接器已运行。更改监听参数前请先运行此 EXE 加 --stop。");
                    } else {
                        if (OwnedProcessAlive(record))
                            throw new Exception("现有桥接进程仍在运行，但无法确认连接状态；请稍后重试，避免重复启动。");
                        string instance = Guid.NewGuid().ToString();
                        var nodeArgs = new List<string> { "--port", options.ContainsKey("--port") ? options["--port"] : "0" };
                        AddOption(options, nodeArgs, "--agent-address");
                        AddOption(options, nodeArgs, "--agent-port");
                        using (Process server = RunNode(root, "src/server.mjs", nodeArgs, instance)) {
                            Stopwatch timer = Stopwatch.StartNew();
                            record = null;
                            while (timer.ElapsedMilliseconds < 60000) {
                                if (server.HasExited) {
                                    string errorFile = Path.Combine(data, "startup-error.txt");
                                    throw new Exception(File.Exists(errorFile) ? File.ReadAllText(errorFile) : "桥接服务启动失败。");
                                }
                                Dictionary<string, object> candidate = ReadRecord();
                                if (candidate != null && Text(candidate, "instanceId") == instance && IsRunning(candidate)) {
                                    record = candidate;
                                    break;
                                }
                                Thread.Sleep(250);
                            }
                            if (record == null) {
                                // This is only the new bridge process, which has not become ready.
                                if (!server.HasExited) server.Kill();
                                throw new Exception("桥接服务连接超时，已停止本次未就绪的桥接进程。官方任务不受影响。");
                            }
                        }
                    }
                    if (!quiet) OpenWindow(Text(record, "address"));
                    return 0;
                } finally { if (locked) mutex.ReleaseMutex(); }
            }
        } catch (Exception error) {
            try { if (data != null) File.WriteAllText(Path.Combine(data, "launcher-error.txt"), error.Message, Encoding.UTF8); } catch { }
            if (!quiet) MessageBox.Show(error.Message, "Remote Codex", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static Dictionary<string, string> Parse(string[] args) {
        var result = new Dictionary<string, string>();
        for (int i = 0; i < args.Length; i++) {
            string key = args[i];
            if (result.ContainsKey(key)) throw new Exception("重复参数：" + key);
            if (key == "--headless" || key == "--stop" || key == "--self-test") result[key] = "true";
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
    private static void OpenWindow(string address) {
        string edge = null;
        foreach (string folder in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) }) {
            string candidate = Path.Combine(folder, "Microsoft/Edge/Application/msedge.exe");
            if (File.Exists(candidate)) { edge = candidate; break; }
        }
        if (edge == null) throw new Exception("未找到 Microsoft Edge。桥接器已启动，可用浏览器打开：" + address);
        // The visible app window is the requested user interface. The service remains hidden.
        Process.Start(new ProcessStartInfo {
            FileName = edge,
            Arguments = Quote("--app=" + address + "/?ui=" + PortableBuild.Version) + " " +
                Quote("--user-data-dir=" + Path.Combine(data, "windows-ui-profile")) + " --no-first-run --no-default-browser-check --window-size=1440,960",
            UseShellExecute = false, WindowStyle = ProcessWindowStyle.Normal
        });
    }
}

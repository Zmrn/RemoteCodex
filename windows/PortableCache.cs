using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

// Only immutable application files live here. Never read, move or reset data/.
internal sealed class PortableCache {
    private readonly string versions, name, payloadHash;
    private readonly Func<Stream> openPayload;
    private readonly Dictionary<string,string> files = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool MoveFileEx(string source, string destination, int flags);

    internal PortableCache(string home, string version, string hash, string manifest, Func<Stream> payload) {
        if (!Regex.IsMatch(version, @"^\d+\.\d+\.\d+$") || !Regex.IsMatch(hash, "^[a-f0-9]{64}$"))
            throw new InvalidDataException("程序内置版本信息无效。");
        versions = Path.Combine(Path.GetFullPath(home), "versions");
        name = version + "-" + hash.Substring(0,12); payloadHash = hash; openPayload = payload;
        foreach (string line in manifest.Split('\n')) {
            if (String.IsNullOrWhiteSpace(line)) continue;
            string[] parts = line.TrimEnd('\r').Split('\t');
            if (parts.Length != 2 || !Regex.IsMatch(parts[0], "^[a-f0-9]{64}$")) throw new InvalidDataException("程序内置文件清单无效。");
            ValidateName(parts[1]);
            if (files.ContainsKey(parts[1])) throw new InvalidDataException("程序内置文件清单包含重复路径。");
            files.Add(parts[1], parts[0]);
        }
        if (files.Count == 0) throw new InvalidDataException("程序内置文件清单为空。");
    }
    private static void ValidateName(string name) {
        if (String.IsNullOrEmpty(name) || name.Contains("\\")) throw new InvalidDataException("程序资源路径无效。");
        foreach (string part in name.Split('/')) {
            if (String.IsNullOrEmpty(part) || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") ||
                part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)", RegexOptions.IgnoreCase))
                throw new InvalidDataException("程序资源路径无效。");
        }
    }
    private static string Digest(Stream stream) {
        using (SHA256 sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
    }
    private static FileAttributes? Attributes(string path) {
        try { return File.GetAttributes(path); }
        catch (FileNotFoundException) { return null; }
        catch (DirectoryNotFoundException) { return null; }
    }
    private static void CheckPath(string path) {
        for (string current = Path.GetFullPath(path); current != null; current = Path.GetDirectoryName(current)) {
            var attributes = Attributes(current);
            if (attributes.HasValue && (attributes.Value & FileAttributes.ReparsePoint) != 0)
                throw new IOException("程序缓存路径不能使用链接：" + current);
        }
    }
    private static void CreateDirectory(string path) { CheckPath(path); Directory.CreateDirectory(path); }
    private static string Inside(string root, string relative) {
        ValidateName(relative);
        string file = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        if (!file.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("程序资源路径越界。");
        if (file.Length >= 260) throw new PathTooLongException("程序缓存路径过长，请使用较短的 --home 目录：" + root);
        return file;
    }
    // A sharing violation is not evidence of corruption. Retry briefly, then
    // report it without creating copies or modifying a possibly active cache.
    private static string FileDigest(string file) {
        for (int attempt=0;;attempt++) {
            try { using (var stream = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read)) return Digest(stream); }
            catch (IOException error) {
                int code = error.HResult & 0xffff;
                if ((code != 32 && code != 33) || attempt >= 9) throw;
                Thread.Sleep(100);
            }
        }
    }
    private bool Verify(string root, out string reason) {
        CheckPath(root);
        if (!Directory.Exists(root)) { reason = "程序缓存目录缺失"; return false; }
        foreach (var item in files) {
            string file = Inside(root, item.Key); CheckPath(file);
            var attributes = Attributes(file);
            if (!attributes.HasValue || (attributes.Value & FileAttributes.Directory) != 0) { reason = "文件缺失：" + item.Key; return false; }
            if (FileDigest(file) != item.Value) { reason = "文件校验失败：" + item.Key; return false; }
        }
        reason = null; return true;
    }
    internal string Ensure() {
        string lockHash;
        using (var bytes = new MemoryStream(Encoding.UTF8.GetBytes(versions.ToUpperInvariant()))) lockHash = Digest(bytes);
        string user = WindowsIdentity.GetCurrent().User.Value;
        using (var mutex = new Mutex(false, "Global\\RemoteCodex-Cache-" + user + "-" + lockHash.Substring(0,24))) {
            bool locked = false;
            try {
                try { locked = mutex.WaitOne(30000); } catch (AbandonedMutexException) { locked = true; }
                if (!locked) throw new IOException("程序缓存正在准备，请稍后重新打开。");
                CreateDirectory(versions);
                string root = Path.Combine(versions, name), reason;
                if (Verify(root, out reason)) return root;
                // A recovery never renames/deletes the old directory: another
                // process may still be using its DLLs or embedded runtime.
                var candidates = new List<string>();
                foreach (string directory in Directory.GetDirectories(versions, name + ".recovered-*")) {
                    string suffix = Path.GetFileName(directory).Substring((name + ".recovered-").Length);
                    if (Regex.IsMatch(suffix, "^[a-f0-9]{8}$")) candidates.Add(directory);
                }
                candidates.Sort(StringComparer.Ordinal);
                foreach (string candidate in candidates) { string ignored; if (Verify(candidate, out ignored)) return candidate; }
                try { return Extract(root); }
                catch (Exception error) {
                    if (!(error is IOException) && !(error is UnauthorizedAccessException) && !(error is Win32Exception)) throw;
                    throw new IOException("无法准备完整的程序缓存（" + reason + "）。原缓存和用户数据已保留。请检查可用磁盘空间、文件占用及访问权限后重试。详情：" + error.Message, error);
                }
            } finally { if (locked) mutex.ReleaseMutex(); }
        }
    }
    private string Extract(string canonical) {
        using (Stream stream = openPayload()) {
            if (stream == null || !stream.CanSeek || Digest(stream) != payloadHash)
                throw new InvalidDataException("EXE 内置资源校验失败，请重新下载完整安装包。");
            stream.Position = 0;
            string staging = Path.Combine(versions, ".extract-" + Guid.NewGuid().ToString("N"));
            CreateDirectory(staging);
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read, true)) {
                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var entry in zip.Entries) {
                    if (!files.ContainsKey(entry.FullName) || !seen.Add(entry.FullName)) throw new InvalidDataException("EXE 内置资源与文件清单不符。");
                    string target = Inside(staging, entry.FullName);
                    CreateDirectory(Path.GetDirectoryName(target));
                    using (Stream input = entry.Open())
                    using (var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.WriteThrough)) {
                        input.CopyTo(output);
                        output.Flush(true); // Flush OS buffers before publishing the directory.
                    }
                }
                if (seen.Count != files.Count) throw new InvalidDataException("EXE 内置资源缺少文件。");
            }
            string reason;
            if (!Verify(staging, out reason)) throw new InvalidDataException("新程序缓存校验失败：" + reason);
            string destination = Attributes(canonical).HasValue ? RecoveryPath() : canonical;
            // Same-volume rename publishes only a complete, verified directory.
            // Interrupted staging directories are never trusted or executed.
            for (int attempt=0;;attempt++) {
                CheckPath(versions); CheckPath(destination);
                if (Attributes(destination).HasValue) destination = RecoveryPath();
                foreach (string relative in files.Keys) Inside(destination, relative);
                if (MoveFileEx(staging, destination, 8 /* MOVEFILE_WRITE_THROUGH */)) break;
                int error = Marshal.GetLastWin32Error();
                if ((error != 5 && error != 32 && error != 33) || attempt >= 29) throw new Win32Exception(error);
                Thread.Sleep(200);
            }
            if (!Verify(destination, out reason)) throw new InvalidDataException("发布后的程序缓存校验失败：" + reason);
            return destination;
        }
    }
    // Keep recovery paths shorter than staging paths; never replace an existing
    // directory even if a random suffix collides.
    private string RecoveryPath() { return Path.Combine(versions, name + ".recovered-" + Guid.NewGuid().ToString("N").Substring(0,8)); }
}

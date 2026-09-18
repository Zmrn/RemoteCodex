using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

public static class PortableCacheTests {
    static string fixture, baseHome;
    static int checks;
    static string Hash(byte[] bytes) { using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(); }
    static string Text(string name) { return File.ReadAllText(Path.Combine(fixture,name)); }
    static PortableCache Cache(string home, Func<Stream> open = null, string manifest = null) {
        return new PortableCache(home,"0.10.41",Text("hash.txt").Trim(),manifest??Text("files.txt"),open??(() => File.OpenRead(Path.Combine(fixture,"payload.zip"))));
    }
    static string Fresh(string name) { string home=Path.Combine(baseHome,name);Directory.CreateDirectory(Path.Combine(home,"data"));File.WriteAllText(Path.Combine(home,"data/agents.json"),"saved encrypted devices and drafts");return home; }
    static void Require(bool ok,string message) { if(!ok)throw new Exception(message); }
    static void Passed(string message) { checks++;Console.WriteLine("PASS "+message); }
    static void Reject(Action action,string message) { bool rejected=false;try{action();}catch(IOException){rejected=true;}catch(InvalidDataException){rejected=true;}catch(UnauthorizedAccessException){rejected=true;}Require(rejected,message); }
    static void DataUnchanged(string home) { Require(File.ReadAllText(Path.Combine(home,"data/agents.json"))=="saved encrypted devices and drafts","Data changed"); }
    static string Corrupt(string root) { string file=Path.Combine(root,"src/official_thread_index.py");File.WriteAllBytes(file,new byte[3353]);return file; }
    static int RecoveryCount(string home) { return Directory.GetDirectories(Path.Combine(home,"versions"),"*.recovered-*").Length; }
    public static void Run(string fixturePath,string homePath,string mode) {
        fixture=fixturePath;baseHome=homePath;
        if(mode=="real") {
            var assembly=Assembly.LoadFile(Path.GetFullPath(fixturePath));
            string manifest;using(var reader=new StreamReader(assembly.GetManifestResourceStream("payload.files")))manifest=reader.ReadToEnd();
            string hash;using(var stream=assembly.GetManifestResourceStream("payload.zip"))using(var buffer=new MemoryStream()){stream.CopyTo(buffer);hash=Hash(buffer.ToArray());}
            var version=assembly.GetName().Version;string v=version.Major+"."+version.Minor+"."+version.Build;
            string realHome=Fresh("released-bundle");
            var realCache=new PortableCache(realHome,v,hash,manifest,()=>assembly.GetManifestResourceStream("payload.zip"));
            string originalBundle=realCache.Ensure();Corrupt(originalBundle);string runtime=Path.Combine(originalBundle,"runtime/python/python313.zip");File.WriteAllBytes(runtime,new byte[new FileInfo(runtime).Length]);
            string recovered=realCache.Ensure();Require(recovered!=originalBundle && realCache.Ensure()==recovered,"Real cloud payload did not recover");
            DataUnchanged(realHome);Console.WriteLine("PASS real released payload extracts, repairs both zero files and reuses verified recovery");return;
        }
        if(mode=="ensure") { Console.WriteLine(Cache(homePath).Ensure());return; }
        if(mode=="interrupt") {
            Cache(homePath,()=>new PausedStream(File.ReadAllBytes(Path.Combine(fixture,"payload.zip")),homePath)).Ensure();return;
        }
        string home=Fresh("clean");var cache=Cache(home);string root=cache.Ensure();
        Require(cache.Ensure()==root,"Clean cache should be reused");DataUnchanged(home);Passed("fresh extraction and second launch reuse the same verified cache");
        // Invoke the actual launcher's Extract method, with only synthetic resources.
        typeof(PortableLauncher).GetField("home",BindingFlags.NonPublic|BindingFlags.Static).SetValue(null,home);
        string wired=(string)typeof(PortableLauncher).GetMethod("Extract",BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,null);
        Require(wired==root,"Launcher is not wired to tested cache");Passed("actual launcher Extract uses the production cache module");
        string bad=Corrupt(root);File.WriteAllBytes(Path.Combine(root,"runtime/python/python313.zip"),new byte[3763064]);
        byte[] original=File.ReadAllBytes(bad);
        string repaired;
        using(var live=new FileStream(bad,FileMode.Open,FileAccess.Read,FileShare.Read)) repaired=cache.Ensure();
        Require(repaired!=root && repaired.Contains(".recovered-"),"Expected separate repaired cache");
        Require(File.ReadAllBytes(bad).SequenceEqual(original),"Damaged original changed");
        Require(File.ReadAllBytes(Path.Combine(root,"runtime/python/python313.zip")).All(b=>b==0),"Original runtime changed");
        Require(cache.Ensure()==repaired && RecoveryCount(home)==1,"Recovery should be reused");DataUnchanged(home);Passed("two all-zero files recover without changing a cache still held open; later starts reuse recovery");
        Corrupt(repaired);string repairedAgain=cache.Ensure();Require(repairedAgain!=repaired && RecoveryCount(home)==2,"Damaged recovery must remain intact");DataUnchanged(home);Passed("repeated corruption preserves both previous directories");
        home=Fresh("missing");root=Cache(home).Ensure();File.Delete(Path.Combine(root,"src/official_thread_index.py"));Require(Cache(home).Ensure()!=root,"Missing file not repaired");DataUnchanged(home);Passed("missing file recovers in a separate verified directory");
        home=Fresh("truncated");root=Cache(home).Ensure();File.WriteAllText(Path.Combine(root,"src/official_thread_index.py"),"partial");Require(Cache(home).Ensure()!=root,"Truncated file not repaired");DataUnchanged(home);Passed("truncated file recovers without deleting the original");
        home=Fresh("sharing");root=Cache(home).Ensure();bad=Path.Combine(root,"src/official_thread_index.py");
        using(var held=new FileStream(bad,FileMode.Open,FileAccess.ReadWrite,FileShare.None))Reject(()=>Cache(home).Ensure(),"Sharing violation should fail closed");
        Require(RecoveryCount(home)==0,"Sharing violation made an unnecessary recovery");Require(Cache(home).Ensure()==root,"Cache should work after lock release");Passed("sharing violations do not become false corruption or overwrite active files");
        home=Fresh("bad-payload");root=Cache(home).Ensure();Corrupt(root);
        Reject(()=>Cache(home,()=>new MemoryStream(new byte[100])).Ensure(),"Corrupt embedded payload accepted");Require(RecoveryCount(home)==0,"Corrupt payload published");DataUnchanged(home);Passed("corrupt embedded payload is rejected with data and original preserved");
        home=Fresh("missing-entry");
        Reject(()=>Cache(home,null,Text("files.txt")+new string('a',64)+"\tmissing.txt\n").Ensure(),"Incomplete archive accepted");
        Require(RecoveryCount(home)==0,"Incomplete archive published");DataUnchanged(home);Passed("archive/manifest mismatch never publishes an incomplete cache");
        home=Fresh("interrupted-staging");Directory.CreateDirectory(Path.Combine(home,"versions/.extract-leftover"));File.WriteAllText(Path.Combine(home,"versions/.extract-leftover/partial"),"keep");
        root=Cache(home).Ensure();Require(!root.Contains(".extract-"),"Partial staging was executed");Require(File.ReadAllText(Path.Combine(home,"versions/.extract-leftover/partial"))=="keep","Orphan unexpectedly deleted");Passed("abandoned extraction directories are ignored and preserved");
        foreach(string unsafeName in new[]{"../data/agents.json","/data/file","C:/data/file","src/../data","src/file:stream","src/CON","src/file.","src\\file"})
            Reject(()=>Cache(home,null,new string('a',64)+"\t"+unsafeName+"\n"),"Unsafe manifest accepted: "+unsafeName);
        Reject(()=>Cache(home,null,Text("files.txt")+Text("files.txt")),"Duplicate manifest accepted");Passed("traversal, ADS, device names and duplicate manifest paths are rejected");
        home=Fresh("wrong-hash");string wrong=Text("files.txt").Replace(Text("files.txt").Substring(0,64),new string('a',64));
        Reject(()=>Cache(home,null,wrong).Ensure(),"Fresh bytes mismatching manifest were accepted");DataUnchanged(home);Passed("fresh extraction is hashed before publication");
        Console.WriteLine("CHECKS "+checks);
    }
    sealed class PausedStream : MemoryStream {
        readonly string home;bool extracting;
        internal PausedStream(byte[] bytes,string home):base(bytes){this.home=home;}
        public override long Position {get{return base.Position;}set{base.Position=value;if(value==0)extracting=true;}}
        public override int Read(byte[] buffer,int offset,int count) {
            if(extracting && Directory.Exists(Path.Combine(home,"versions")) && Directory.GetFiles(Path.Combine(home,"versions"),"official_thread_index.py",SearchOption.AllDirectories).Length>0) {
                File.WriteAllText(Path.Combine(home,"paused.txt"),"after first extracted file");
                while(true)Thread.Sleep(100);
            }
            return base.Read(buffer,offset,count);
        }
    }
}

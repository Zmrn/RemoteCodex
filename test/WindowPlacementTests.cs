using System;
using System.Drawing;
using System.IO;
using System.Windows.Forms;

internal static class WindowPlacementTests {
    private static readonly Rectangle[] lowScreen = { new Rectangle(0, 0, 1024, 728) };
    private static readonly string[] names = { "test-screen" };
    private static void Check(bool condition, string description) {
        if (!condition) throw new Exception(description);
        Console.WriteLine("PASS " + description);
    }
    [STAThread]
    private static int Main(string[] args) {
        try {
            string folder = args[1];
            Directory.CreateDirectory(folder);
            var store = new WindowPlacement(folder);
            if (args[0] == "write") {
                store.Remember(new Rectangle(75, 85, 820, 610), FormWindowState.Normal, names[0]);
                store.Save();
                return 0;
            }
            var restored = store.Resolve(lowScreen, names, 0);
            Check(restored.Bounds == new Rectangle(75, 85, 820, 610), "size and position survive process restart");
            store.Remember(new Rectangle(75, 85, 820, 610), FormWindowState.Maximized, names[0]);
            store.Remember(new Rectangle(-32000, -32000, 160, 30), FormWindowState.Minimized, names[0]);
            store.Save();
            restored = new WindowPlacement(folder).Resolve(lowScreen, names, 0);
            Check(restored.Maximized && restored.Bounds == new Rectangle(75, 85, 820, 610), "minimize preserves maximized state and normal restore size");
            store.Remember(new Rectangle(75, 85, 820, 610), FormWindowState.Normal, names[0]);
            store.Save();
            Check(!new WindowPlacement(folder).WasMaximized, "leaving maximized mode persists normal state");
            var small = new[] { new Rectangle(0, 0, 800, 560) };
            restored = store.Resolve(small, names, 0);
            Check(restored.Bounds == new Rectangle(0, 0, 800, 560), "smaller resolution clamps to taskbar-free working area");
            store.Remember(new Rectangle(-1800, 40, 850, 620), FormWindowState.Normal, "removed-screen");
            restored = store.Resolve(lowScreen, names, 0);
            Check(lowScreen[0].Contains(restored.Bounds) && restored.Left == 87, "disconnected monitor recovers centered on available screen");
            var dual = new[] { new Rectangle(0, 0, 1920, 1040), new Rectangle(-1280, 0, 1280, 984) };
            var dualNames = new[] { "primary", "left" };
            store.Remember(new Rectangle(-1200, 50, 820, 610), FormWindowState.Normal, "left");
            restored = store.Resolve(dual, dualNames, 0);
            Check(restored.Left == -1200 && dual[1].Contains(restored.Bounds), "negative monitor coordinates remain valid");
            store.Remember(new Rectangle(80, 50, 820, 610), FormWindowState.Normal, "left");
            restored = store.Resolve(dual, dualNames, 0);
            Check(dual[1].Contains(restored.Bounds), "monitor rearrangement follows saved screen");
            string fresh = Path.Combine(folder, "fresh");
            restored = new WindowPlacement(fresh).Resolve(lowScreen, names, 0);
            Check(restored.Width == 921 && restored.Height == 655 && lowScreen[0].Contains(restored.Bounds), "first launch uses 90 percent of a low-resolution working area");
            var tiny = new[] { new Rectangle(0, 0, 320, 360) };
            restored = store.Resolve(tiny, names, 0);
            Check(tiny[0].Contains(restored.Bounds), "minimum size never exceeds available screen");
            Directory.CreateDirectory(fresh);
            File.WriteAllText(Path.Combine(fresh, "window-placement.json"), "{broken");
            restored = new WindowPlacement(fresh).Resolve(lowScreen, names, 0);
            Check(lowScreen[0].Contains(restored.Bounds), "corrupt preferences safely use a visible default");
            File.WriteAllText(Path.Combine(fresh, "window-placement.json"), "{\"SchemaVersion\":1,\"Width\":-1,\"Height\":999999999,\"Left\":2147483647}");
            Check(new WindowPlacement(fresh).Resolve(lowScreen, names, 0).Width == 921, "invalid saved geometry cannot overflow screen calculations");
            // Exercise the production Form restore path without showing a
            // window, touching focus, starting a service, or opening ChatGPT.
            using (var form = new Form()) {
                store = new WindowPlacement(folder);
                store.Restore(form);
                Check(form.StartPosition == FormStartPosition.Manual, "WinForms does not recenter restored bounds");
                Check(Screen.FromRectangle(form.Bounds).WorkingArea.Contains(form.Bounds), "actual Windows screen contains restored form");
            }
            return 0;
        } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
    }
}

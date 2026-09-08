using System;
using System.Drawing;
using System.IO;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Local desktop preferences live outside the versioned application payload.
// Coordinates use the same WinForms coordinate space as Screen.WorkingArea.
public sealed class WindowPlacementState {
    public int SchemaVersion { get; set; }
    public int Left { get; set; }
    public int Top { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public bool Maximized { get; set; }
    public string ScreenName { get; set; }
    public Rectangle Bounds { get { return new Rectangle(Left, Top, Width, Height); } }
    public bool IsValid() {
        return SchemaVersion == 1 && Width > 0 && Height > 0 && Width <= 100000 && Height <= 100000 &&
            Left >= -100000 && Left <= 100000 && Top >= -100000 && Top <= 100000;
    }
}

public sealed class WindowPlacement {
    private readonly string file;
    private WindowPlacementState current;
    public bool WasMaximized { get { return current != null && current.Maximized; } }
    public WindowPlacement(string dataDirectory) {
        file = Path.Combine(dataDirectory, "window-placement.json");
        try {
            if (new FileInfo(file).Length > 8192) return;
            var saved = new JavaScriptSerializer().Deserialize<WindowPlacementState>(File.ReadAllText(file));
            if (saved != null && saved.IsValid()) current = saved;
        } catch (IOException) { } catch (UnauthorizedAccessException) { } catch (ArgumentException) { } catch (InvalidOperationException) { }
    }
    public static Size MinimumFor(Rectangle area) {
        return new Size(Math.Min(360, area.Width), Math.Min(400, area.Height));
    }
    public WindowPlacementState Resolve(Rectangle[] areas, string[] names, int primary) {
        if (areas == null || areas.Length == 0) throw new ArgumentException("No working screen area");
        primary = Math.Max(0, Math.Min(primary, areas.Length - 1));
        int target = primary;
        bool matched = false;
        if (current != null && names != null && !String.IsNullOrEmpty(current.ScreenName))
            for (int i = 0; i < Math.Min(names.Length, areas.Length); i++)
                if (names[i] == current.ScreenName) { target = i; matched = true; break; }
        if (current != null && !matched) {
            long largest = 0;
            for (int i = 0; i < areas.Length; i++) {
                Rectangle overlap = Rectangle.Intersect(current.Bounds, areas[i]);
                long size = (long)overlap.Width * overlap.Height;
                if (size > largest) { largest = size; target = i; }
            }
        }
        Rectangle work = areas[target];
        Size minimum = MinimumFor(work);
        int width = Math.Min(work.Width, Math.Max(minimum.Width, current == null ? Math.Min(1440, work.Width * 9 / 10) : current.Width));
        int height = Math.Min(work.Height, Math.Max(minimum.Height, current == null ? Math.Min(960, work.Height * 9 / 10) : current.Height));
        bool center = current == null || !current.Bounds.IntersectsWith(work);
        int left = center ? work.Left + (work.Width - width) / 2 : current.Left;
        int top = center ? work.Top + (work.Height - height) / 2 : current.Top;
        return new WindowPlacementState {
            SchemaVersion = 1, Width = width, Height = height,
            Left = Math.Max(work.Left, Math.Min(left, work.Right - width)),
            Top = Math.Max(work.Top, Math.Min(top, work.Bottom - height)),
            Maximized = WasMaximized,
            ScreenName = names != null && names.Length > target ? names[target] : null
        };
    }
    public void Restore(Form form) {
        Screen[] screens = Screen.AllScreens;
        Rectangle[] areas = new Rectangle[screens.Length];
        string[] names = new string[screens.Length];
        int primary = 0;
        for (int i = 0; i < screens.Length; i++) {
            areas[i] = screens[i].WorkingArea; names[i] = screens[i].DeviceName;
            if (screens[i].Primary) primary = i;
        }
        current = Resolve(areas, names, primary);
        form.StartPosition = FormStartPosition.Manual;
        form.MinimumSize = MinimumFor(Screen.FromRectangle(current.Bounds).WorkingArea);
        form.Bounds = current.Bounds;
        form.WindowState = current.Maximized ? FormWindowState.Maximized : FormWindowState.Normal;
    }
    public void Remember(Rectangle normalBounds, FormWindowState state, string screenName) {
        // Minimize events may contain Windows' offscreen icon coordinates.
        // Keep both the normal restore rectangle and the preceding max state.
        if (state == FormWindowState.Minimized) return;
        var next = new WindowPlacementState {
            SchemaVersion = 1, Left = normalBounds.Left, Top = normalBounds.Top,
            Width = normalBounds.Width, Height = normalBounds.Height,
            Maximized = state == FormWindowState.Maximized, ScreenName = screenName
        };
        if (next.IsValid()) current = next;
    }
    public void Capture(Form form) {
        if (!form.Visible || form.IsDisposed || form.WindowState == FormWindowState.Minimized) return;
        Rectangle normal = form.WindowState == FormWindowState.Normal ? form.Bounds : form.RestoreBounds;
        Remember(normal, form.WindowState, Screen.FromRectangle(normal).DeviceName);
    }
    public void Save() {
        if (current == null) return;
        string temporary = file + ".tmp";
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            // Only these preferences are serialized, not screen/app/user data.
            var value = new {
                current.SchemaVersion, current.Left, current.Top, current.Width, current.Height,
                current.Maximized, current.ScreenName
            };
            File.WriteAllText(temporary, new JavaScriptSerializer().Serialize(value));
            if (File.Exists(file)) File.Replace(temporary, file, null);
            else File.Move(temporary, file);
        } catch (IOException) { } catch (UnauthorizedAccessException) { }
    }
}

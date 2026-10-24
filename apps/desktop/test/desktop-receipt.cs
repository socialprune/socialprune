// The child finishes the temporary file before renaming it into view. Seeing
// that name is not proof Windows has closed every publication handle yet.
// Do not deny write/delete sharing while reading that immutable receipt.
public static class DesktopReceipt {
  public static string Read(string path) {
    using (var file = new System.IO.FileStream(path, System.IO.FileMode.Open, System.IO.FileAccess.Read,
        System.IO.FileShare.ReadWrite | System.IO.FileShare.Delete))
    using (var reader = new System.IO.StreamReader(file)) return reader.ReadToEnd();
  }
}

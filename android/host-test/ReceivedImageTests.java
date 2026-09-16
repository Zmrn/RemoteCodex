import com.anso.remotecodex.ReceivedImage;
import java.nio.charset.StandardCharsets;
public final class ReceivedImageTests {
  private static byte[] file(String header, int length) {
    byte[] result = new byte[length], prefix = header.getBytes(StandardCharsets.US_ASCII);
    System.arraycopy(prefix, 0, result, 0, prefix.length);return result;
  }
  private static void rejected(byte[] bytes) throws Exception {
    try { ReceivedImage.validate(bytes); } catch(Exception expected) { return; }
    throw new AssertionError("Invalid/oversize image accepted");
  }
  public static void main(String[] args) throws Exception {
    assert ReceivedImage.validate(file("GIF87a", 20)).equals("image/gif");
    assert ReceivedImage.validate(file("GIF89a", 26*1024*1024)).equals("image/gif");
    assert ReceivedImage.validate(file("GIF89a", ReceivedImage.MAX_BYTES)).equals("image/gif");
    rejected(file("GIF89a", ReceivedImage.MAX_BYTES+1));
    rejected(file("GIF88a", 20));rejected(new byte[0]);rejected("not an image".getBytes(StandardCharsets.US_ASCII));
    byte[] png = new byte[]{(byte)137,80,78,71,13,10,26,10};
    assert ReceivedImage.validate(png).equals("image/png");
    byte[] largePng = new byte[25*1024*1024+1];System.arraycopy(png,0,largePng,0,png.length);rejected(largePng);
    assert ReceivedImage.validate(new byte[]{(byte)255,(byte)216,(byte)255}).equals("image/jpeg");
    assert ReceivedImage.validate("RIFF0000WEBP".getBytes(StandardCharsets.US_ASCII)).equals("image/webp");
    System.out.println("PASS: received GIF signatures, MIME, 26/64 MiB, oversize/fake rejection and existing formats; host JVM only");
  }
}

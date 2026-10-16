package tools.supernote.logincallback;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.Window;
import android.widget.TextView;

import java.io.File;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** A narrowly scoped Obsidian deep-link receiver for opening an existing Note page. */
public final class OpenNoteActivity extends Activity {
    private static final String SCHEME = "supernote-transcripts";
    private static final String HOST = "open-note";
    private static final String NOTE_ROOT = "/storage/emulated/0/Note";
    private static final String NOTE_PACKAGE = "com.ratta.supernote.note";
    private static final String NOTE_ACTIVITY = "com.ratta.supernote.note.view.NoteInsidePagesActivity";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        try {
            NoteTarget target = parseTarget(getIntent());
            Intent open = new Intent(Intent.ACTION_VIEW);
            open.setClassName(NOTE_PACKAGE, NOTE_ACTIVITY);
            open.putExtra("file_path", target.path);
            open.putExtra("page", target.page);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(open);
            finish();
        } catch (ActivityNotFoundException ignored) {
            showError("Couldn't open the note. Confirm the Supernote Note app is available, then retry.");
        } catch (InvalidLinkException e) {
            showError(e.message);
        } catch (Exception ignored) {
            showError("Couldn't open this note. Return to Obsidian and try again.");
        }
    }

    private void showError(String message) {
        TextView view = new TextView(this);
        view.setText(message);
        view.setTextSize(20);
        view.setGravity(Gravity.CENTER);
        view.setPadding(28, 28, 28, 28);
        setContentView(view);
    }

    private static NoteTarget parseTarget(Intent intent) throws InvalidLinkException {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) {
            throw invalid("Invalid note link. Return to Obsidian and open the note again.");
        }
        Uri uri = intent.getData();
        if (uri == null || uri.isOpaque()
                || !SCHEME.equals(uri.getScheme()) || !HOST.equals(uri.getHost())
                || !HOST.equals(uri.getEncodedAuthority())
                || uri.getUserInfo() != null || uri.getPort() != -1
                || (uri.getPath() != null && !uri.getPath().isEmpty())
                || uri.getFragment() != null) {
            throw invalid("Invalid note link. Return to Obsidian and open the note again.");
        }

        String query = uri.getEncodedQuery();
        if (query == null) throw invalid("This link is missing its note or page.");
        String[] pairs = query.split("&", -1);
        if (pairs.length != 2) throw invalid("This link must contain one note and one page.");

        String encodedFile = null;
        String encodedPage = null;
        for (String pair : pairs) {
            int equals = pair.indexOf('=');
            if (equals < 0 || equals != pair.lastIndexOf('=')) {
                throw invalid("This link must contain one note and one page.");
            }
            String key = pair.substring(0, equals);
            String value = pair.substring(equals + 1);
            if ("file".equals(key) && encodedFile == null) encodedFile = value;
            else if ("page".equals(key) && encodedPage == null) encodedPage = value;
            else throw invalid("This link must contain one note and one page.");
        }
        if (encodedFile == null || encodedPage == null || encodedFile.isEmpty() || encodedPage.isEmpty()) {
            throw invalid("This link is missing its note or page.");
        }

        String path = strictDecodeQueryValue(encodedFile);
        if (hasControl(path) || path.indexOf('\0') >= 0 || path.indexOf('\\') >= 0
                || path.toLowerCase(Locale.ROOT).contains("%2f")
                || path.toLowerCase(Locale.ROOT).contains("%5c")) {
            throw invalid("This link contains an invalid note path.");
        }
        if (!path.startsWith(NOTE_ROOT + "/")) {
            throw invalid("Open a note stored in the Supernote Note folder.");
        }
        String[] segments = path.substring((NOTE_ROOT + "/").length()).split("/", -1);
        for (String segment : segments) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) {
                throw invalid("This link contains an invalid note path.");
            }
        }

        if (!encodedPage.matches("[1-9][0-9]{0,8}")) {
            throw invalid("The page number must be a positive whole number.");
        }
        final int page;
        try {
            page = Integer.parseInt(encodedPage);
        } catch (NumberFormatException ignored) {
            throw invalid("The page number must be a positive whole number.");
        }

        try {
            File root = new File(NOTE_ROOT).getCanonicalFile();
            File target = new File(path).getCanonicalFile();
            String rootPath = root.getPath();
            if (!target.getPath().startsWith(rootPath + File.separator)
                    || !target.getName().toLowerCase(Locale.ROOT).endsWith(".note")) {
                throw invalid("The linked .note file is missing or outside the Note folder.");
            }
            return new NoteTarget(target.getPath(), page);
        } catch (InvalidLinkException e) {
            throw e;
        } catch (Exception ignored) {
            throw invalid("The linked note could not be checked. Return to Obsidian and retry.");
        }
    }

    /** Decode percent escapes as strict UTF-8 while treating '+' as a literal plus. */
    private static String strictDecodeQueryValue(String value) throws InvalidLinkException {
        List<Byte> bytes = new ArrayList<>();
        for (int i = 0; i < value.length();) {
            char c = value.charAt(i);
            if (c == '%') {
                if (i + 2 >= value.length()) throw invalid("This link contains an invalid note path.");
                int hi = hexValue(value.charAt(i + 1));
                int lo = hexValue(value.charAt(i + 2));
                if (hi < 0 || lo < 0) throw invalid("This link contains an invalid note path.");
                bytes.add((byte) ((hi << 4) | lo));
                i += 3;
            } else {
                // encodeURIComponent leaves only these characters unescaped in a path value.
                if (!isUnescaped(c)) throw invalid("This link contains an invalid note path.");
                bytes.add((byte) c);
                i++;
            }
        }
        byte[] raw = new byte[bytes.size()];
        for (int i = 0; i < bytes.size(); i++) raw[i] = bytes.get(i);
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(raw)).toString();
        } catch (CharacterCodingException ignored) {
            throw invalid("This link contains an invalid note path.");
        }
    }

    private static boolean isUnescaped(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9') || "-_.!~*'()".indexOf(c) >= 0;
    }

    private static int hexValue(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    private static boolean hasControl(String value) {
        for (int i = 0; i < value.length(); i++) {
            if (Character.isISOControl(value.charAt(i))) return true;
        }
        return false;
    }

    private static InvalidLinkException invalid(String message) {
        return new InvalidLinkException(message);
    }

    private static final class NoteTarget {
        final String path;
        final int page;
        NoteTarget(String path, int page) { this.path = path; this.page = page; }
    }

    private static final class InvalidLinkException extends Exception {
        final String message;
        InvalidLinkException(String message) { this.message = message; }
    }
}

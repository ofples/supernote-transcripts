package tools.supernote.logincallback;

import org.junit.Test;

import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.fail;

public final class DigestAnchorRequestTest {
    @Test public void carriesTheExactNativeTargetAndProviderAnchorIdentity() {
        DigestProtocol.Note note = new DigestProtocol.Note(
                "/storage/emulated/0/Note/Reflection/owned.note", 7,
                "file-id-fixture", "native:P-fixture-page-7",
                Arrays.asList("native:P-fixture-page-7", "native:P-fixture-page-6"));

        DigestAnchorRequest request = DigestAnchorRequest.forMarginMarker(
                note, "0123456789abcdef0123456789abcdef", 1792485566956L, "+");

        assertEquals(note.path, request.notePath);
        assertEquals(7, request.page);
        assertEquals(note.fileId, request.fileId);
        assertEquals(note.pageId, request.pageId);
        assertEquals("0123456789abcdef0123456789abcdef", request.digestId);
        assertEquals(1792485566956L, request.digestTimeMillis);
        assertEquals("+", request.markerText);
    }

    @Test public void rejectsMissingOrMalformedProviderIdentityAndTarget() {
        DigestProtocol.Note note = note();
        rejects(null, "0123456789abcdef0123456789abcdef", 100L, "+");
        rejects(note, null, 100L, "+");
        rejects(note, "0123456789abcdef0123456789abcdeZ", 100L, "+");
        rejects(note, "0123456789abcdef0123456789abcdef", 0L, "+");
        rejects(note, "0123456789abcdef0123456789abcdef", -1L, "+");
        rejects(note, "0123456789abcdef0123456789abcdef", 100L, " ");
        rejects(note, "0123456789abcdef0123456789abcdef", 100L, "quoted excerpt");
        rejects(note, "0123456789abcdef0123456789abcdef", 100L, "++");
    }

    private static DigestProtocol.Note note() {
        return new DigestProtocol.Note("/storage/emulated/0/Note/Reflection/owned.note", 7,
                "file-id-fixture", "native:P-fixture-page-7",
                Arrays.asList("native:P-fixture-page-7"));
    }

    private static void rejects(DigestProtocol.Note note, String digestId, long digestTime, String marker) {
        try {
            DigestAnchorRequest.forMarginMarker(note, digestId, digestTime, marker);
            fail("Expected invalid anchor request");
        } catch (IllegalArgumentException expected) {
            // Invalid inputs must be rejected before any backend can be invoked.
        }
    }
}

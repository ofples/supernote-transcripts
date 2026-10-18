package tools.supernote.logincallback;

import org.junit.Test;

import java.nio.charset.StandardCharsets;

import static org.junit.Assert.*;

public final class DigestProtocolTest {
    private static final String ID = repeat('a', 64);
    private static final String BASE = "{\"version\":1,\"requestId\":\"" + ID
            + "\",\"text\":\"Digest line\\nsecond\\tline 😀\",\"origin\":{\"vault\":\"Vedas\",\"file\":\"Satsang/2610.md\",\"heading\":\"Reflection\",\"before\":\"before\",\"after\":\"after\"}}";

    @Test public void acceptsReviewableManualRequestAndBuildsBoundedProvenance() throws Exception {
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(BASE));
        assertEquals("Digest line\nsecond\tline 😀", p.text);
        assertEquals("Satsang/2610.md", p.origin.file);
        assertTrue(DigestProtocol.manualComment(p).startsWith("Obsidian: Satsang/2610.md\nobsidian://open?"));
        assertTrue(DigestProtocol.metadataJson(p).contains("\"supernote_bridge\""));
        assertFalse(DigestProtocol.metadataJson(p).contains(p.text));
    }

    @Test public void acceptsBoundedNotebookTargetAndPreservesIdsForManualMetadata() throws Exception {
        String json = BASE.substring(0, BASE.length() - 1)
                + ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":2,\"fileId\":\"opaque-header-id\",\"pageId\":\"native:P-fixture-page-2\",\"pageIds\":[\"native:P-fixture-page-2\",\"native:P-fixture-page-1\"]}}";
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(json));
        assertEquals(2, p.note.page);
        assertEquals("native:P-fixture-page-2", p.note.pageIds.get(0));
        String metadata = DigestProtocol.metadataJson(p);
        assertTrue(metadata.contains("\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":\"2\",\"fileId\":\"opaque-header-id\",\"pageId\":\"native:P-fixture-page-2\",\"pageIds\":[\"native:P-fixture-page-2\",\"native:P-fixture-page-1\"]}"));
        assertTrue(DigestProtocol.manualComment(p).startsWith("Supernote: 1.note · page 2\nObsidian: Satsang/2610.md\n"));
        assertFalse(metadata.contains("note_fileId"));
        assertFalse(metadata.contains("note_pageId"));
        assertFalse(metadata.contains("note_page\""));
        assertFalse(metadata.contains("unique_identifier"));
        String providerMetadata = metadata.substring(0, metadata.length() - 1)
                + ",\"unique_identifier\":\"0123456789abcdef0123456789abcdef\"}";
        assertTrue(DigestProtocol.metadataMatches(p, providerMetadata));
        assertFalse(DigestProtocol.metadataMatches(p, providerMetadata.replace("\"page\":\"2\"", "\"page\":\"3\"")));
    }

    @Test public void acceptsOnlyFixedProviderAcknowledgementItemRoutes() {
        assertEquals(123L, DigestProtocol.parseProviderAcknowledgement("content://com.ratta.supernote.knowledge.provider/knowledge/123"));
        assertEquals(456L, DigestProtocol.parseProviderAcknowledgement("content://com.ratta.supernote.knowledge.provider/knowledge/insert/456"));
        assertEquals(-1L, DigestProtocol.parseProviderAcknowledgement("content://evil/knowledge/123"));
        assertEquals(-1L, DigestProtocol.parseProviderAcknowledgement("content://com.ratta.supernote.knowledge.provider/knowledge/insert"));
        assertEquals(-1L, DigestProtocol.parseProviderAcknowledgement("content://com.ratta.supernote.knowledge.provider/knowledge/1?x=2"));
        assertEquals(-1L, DigestProtocol.parseProviderAcknowledgement("content://com.ratta.supernote.knowledge.provider/knowledge/0"));
    }

    @Test public void metadataReadbackAllowsOnlyProviderGeneratedIdentifierExtra() throws Exception {
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(BASE));
        String expected = DigestProtocol.metadataJson(p);
        String withGeneratedId = expected.substring(0, expected.length() - 1)
                + ",\"unique_identifier\":\"0123456789abcdef0123456789abcdef\"}";
        assertTrue(DigestProtocol.metadataMatches(p, expected));
        assertTrue(DigestProtocol.metadataMatches(p, withGeneratedId));
        assertTrue(DigestProtocol.metadataMatches(p, withGeneratedId.replace("0123456789abcdef0123456789abcdef", "0123456789ABCDEF0123456789ABCDEF")));
        assertFalse(DigestProtocol.metadataMatches(p, withGeneratedId.replace("\"file\":\"Satsang/2610.md\"", "\"file\":\"Other.md\"")));
        assertFalse(DigestProtocol.metadataMatches(p, expected.substring(0, expected.length() - 1) + ",\"other\":1}"));
        assertFalse(DigestProtocol.metadataMatches(p, expected.substring(0, expected.length() - 1)
                + ",\"unique_identifier\":\"not-a-32-hex-id\"}"));
    }

    @Test public void rejectsWrongUriAndUnescapedQueryCharacters() {
        rejects("https://digest?payload=" + encode(BASE));
        rejects("supernote-bridge://digest/extra?payload=" + encode(BASE));
        rejects("supernote-bridge://digest?payload=" + encode(BASE) + "&extra=x");
        rejects("supernote-bridge://digest?payload=" + encode(BASE).replace("%7B", "{"));
    }

    @Test public void rejectsUnknownKeysWrongVersionAndDuplicateJsonKeys() {
        rejects(link(BASE.substring(0, BASE.length() - 1) + ",\"extra\":true}"));
        rejects(link(BASE.replace("\"version\":1", "\"version\":2")));
        rejects(link(BASE.replace("\"version\":1", "\"version\":1,\"version\":1")));
    }

    @Test public void rejectsUnsafeOriginsControlsAndMalformedSurrogates() {
        rejects(link(BASE.replace("Satsang/2610.md", "../2610.md")));
        rejects(link(BASE.replace("Satsang/2610.md", "C:/2610.md")));
        rejects(link(BASE.replace("Vedas", "bad\\u0001vault")));
        rejects(link(BASE.replace("😀", "\\ud800")));
    }

    @Test public void permitsLiteralPercentDotInOriginFilenameButRejectsEncodedSeparators() throws Exception {
        String literal = BASE.replace("Satsang/2610.md", "Satsang/Study%2eNotes.md");
        assertEquals("Satsang/Study%2eNotes.md", DigestProtocol.parseDeepLink(link(literal)).origin.file);
        rejects(link(BASE.replace("Satsang/2610.md", "Satsang/Study%2fNotes.md")));
    }

    @Test public void rejectsOversizedTextAndJson() {
        String tooMuchText = BASE.replace("Digest line\\nsecond\\tline 😀", repeat('x', 15001));
        rejects(link(tooMuchText));
        StringBuilder padding = new StringBuilder(BASE);
        int at = padding.indexOf("\"after\":\"after\"");
        // Whitespace is legal JSON but counts toward the decoded request cap.
        padding.insert(at, repeat(' ', DigestProtocol.MAX_DECODED_JSON_LENGTH));
        rejects(link(padding.toString()));
    }

    @Test public void rejectsDuplicateOrMisorderedNotebookPageIdsAndTraversal() {
        String duplicate = BASE.substring(0, BASE.length() - 1)
                + ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":2,\"fileId\":\"opaque-header-id\",\"pageId\":\"native:P-fixture-page-2\",\"pageIds\":[\"native:P-fixture-page-2\",\"native:P-fixture-page-2\"]}}";
        rejects(link(duplicate));
        String wrongFirst = duplicate.replace("[\"native:P-fixture-page-2\",\"native:P-fixture-page-2\"]", "[\"native:P-fixture-page-1\",\"native:P-fixture-page-2\"]");
        rejects(link(wrongFirst));
        String traversal = duplicate.replace("Book/1.note", "Book/../1.note").replace("[\"native:P-fixture-page-2\",\"native:P-fixture-page-2\"]", "[\"native:P-fixture-page-2\"]");
        rejects(link(traversal));
    }

    @Test public void rejectsMetadataThatExceedsProviderFieldBudget() throws Exception {
        StringBuilder ids = new StringBuilder("[");
        String primary = null;
        for (int i = 0; i < 100; i++) {
            if (i > 0) ids.append(',');
            String id = "native:P-fixture-" + String.format(java.util.Locale.ROOT, "%03d", i) + repeat('x', 189);
            if (i == 0) primary = id;
            ids.append('"').append(id).append('"');
        }
        ids.append(']');
        String json = BASE.substring(0, BASE.length() - 1)
                + ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":2,\"fileId\":\"opaque-header-id\",\"pageId\":\""
                + primary + "\",\"pageIds\":" + ids + "}}";
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(json));
        try { DigestProtocol.metadataJson(p); fail("Expected provider metadata field bound"); }
        catch (DigestProtocol.InvalidPayloadException expected) { assertEquals("provider metadata limit", expected.reason); }
    }

    @Test public void noteRequiresNativeIdentifiersAndRejectsShortPageIds() {
        String note = ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":2,\"fileId\":\"opaque-header-id\",\"pageId\":\"native:P-fixture-page-2\",\"pageIds\":[\"native:P-fixture-page-2\"]}}";
        rejects(link(BASE.substring(0, BASE.length() - 1) + note.replace("\"fileId\":\"opaque-header-id\",", "")));
        rejects(link(BASE.substring(0, BASE.length() - 1) + note.replace("native:P-fixture-page-2", "p2")));
        rejects(link(BASE.substring(0, BASE.length() - 1) + note.replace("opaque-header-id", "bad\\u0001id")));
    }

    @Test public void rejectsContentFingerprintsWhereNativePageIdsAreRequired() {
        String note = ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":2,\"fileId\":\"header-id-without-prefix\",\"pageId\":\"native:P-fixture-page-2\",\"pageIds\":[\"native:P-fixture-page-2\"]}}";
        rejects(link(BASE.substring(0, BASE.length() - 1) + note.replace("native:P-fixture-page-2", "content:0123456789abcdef")));
    }

    @Test public void pageIdsMayBeOmittedForSinglePageRequest() throws Exception {
        String json = BASE.substring(0, BASE.length() - 1)
                + ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":2,\"fileId\":\"opaque-header-id\",\"pageId\":\"native:P-fixture-page-2\"}}";
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(json));
        assertEquals(1, p.note.pageIds.size());
        assertEquals("native:P-fixture-page-2", p.note.pageIds.get(0));
        assertTrue(DigestProtocol.metadataJson(p).contains("\"pageIds\":[\"native:P-fixture-page-2\"]"));
    }

    @Test public void lexicalPathRequiresNoteExtensionAndRoot() throws Exception {
        assertEquals("/storage/emulated/0/Note/A.note", DigestProtocol.validateNotePathLexically("/storage/emulated/0/Note/A.note"));
        try { DigestProtocol.validateNotePathLexically("/storage/emulated/0/Other/A.note"); fail(); }
        catch (DigestProtocol.InvalidPayloadException expected) { }
        try { DigestProtocol.validateNotePathLexically("/storage/emulated/0/Note/A.pdf"); fail(); }
        catch (DigestProtocol.InvalidPayloadException expected) { }
    }

    private static void rejects(String uri) {
        try { DigestProtocol.parseDeepLink(uri); fail("Expected invalid URI"); }
        catch (DigestProtocol.InvalidPayloadException expected) { }
    }
    private static String link(String json) { return "supernote-bridge://digest?payload=" + encode(json); }
    private static String encode(String value) {
        StringBuilder b = new StringBuilder();
        for (byte raw : value.getBytes(StandardCharsets.UTF_8)) {
            int c = raw & 0xff;
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || "-_.!~*'()".indexOf(c) >= 0) b.append((char)c);
            else b.append('%').append("0123456789ABCDEF".charAt(c >>> 4)).append("0123456789ABCDEF".charAt(c & 15));
        }
        return b.toString();
    }
    private static String repeat(char c, int count) { char[] chars = new char[count]; java.util.Arrays.fill(chars, c); return new String(chars); }
}

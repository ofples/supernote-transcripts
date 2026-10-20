package tools.supernote.logincallback;

import org.junit.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

import static org.junit.Assert.*;

public final class DigestProtocolTest {
    private static final String ID = repeat('a', 64);
    private static final String BASE = "{\"version\":1,\"requestId\":\"" + ID
            + "\",\"text\":\"Digest line\\nsecond\\tline 😀\",\"origin\":{\"vault\":\"Vedas\",\"file\":\"Satsang/2610.md\",\"heading\":\"Reflection\",\"before\":\"before\",\"after\":\"after\"}}";

    @Test public void acceptsReviewableManualRequestAndBuildsBoundedProvenance() throws Exception {
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(BASE));
        assertEquals("Digest line\nsecond\tline 😀", p.text);
        assertEquals("Satsang/2610.md", p.origin.file);
        assertEquals("Source: Satsang/2610 | Heading: Reflection", DigestProtocol.manualComment(p));
        assertTrue(DigestProtocol.metadataJson(p).contains("\"supernote_bridge\""));
        assertFalse(DigestProtocol.metadataJson(p).contains(p.text));
        String withNote = DigestProtocol.manualComment(p, "My observation");
        assertEquals("Note: My observation\n\nSource: Satsang/2610 | Heading: Reflection", withNote);
        assertTrue(withNote.length() <= 2000);
    }

    @Test public void acceptsBoundedNotebookTargetAndPreservesIdsForManualMetadata() throws Exception {
        String json = BASE.substring(0, BASE.length() - 1)
                + ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":2,\"fileId\":\"opaque-header-id\",\"pageId\":\"native:P-fixture-page-2\",\"pageIds\":[\"native:P-fixture-page-2\",\"native:P-fixture-page-1\"]}}";
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(json));
        assertEquals(2, p.note.page);
        assertEquals("native:P-fixture-page-2", p.note.pageIds.get(0));
        String metadata = DigestProtocol.metadataJson(p);
        assertTrue(metadata.contains("\"note\":{\"path\":\"/storage/emulated/0/Note/Book/1.note\",\"page\":\"2\",\"fileId\":\"opaque-header-id\",\"pageId\":\"native:P-fixture-page-2\",\"pageIds\":[\"native:P-fixture-page-2\",\"native:P-fixture-page-1\"]}"));
        assertEquals("Book/1 | Page 2", DigestProtocol.manualComment(p));
        assertFalse(metadata.contains("note_fileId"));
        assertFalse(metadata.contains("note_pageId"));
        assertFalse(metadata.contains("note_page\""));
        assertFalse(metadata.contains("unique_identifier"));
        String providerMetadata = metadata.substring(0, metadata.length() - 1)
                + ",\"unique_identifier\":\"0123456789abcdef0123456789abcdef\"}";
        assertTrue(DigestProtocol.metadataMatches(p, providerMetadata));
        assertFalse(DigestProtocol.metadataMatches(p, providerMetadata.replace("\"page\":\"2\"", "\"page\":\"3\"")));
    }

    @Test public void plainMarkdownCaptureUsesFriendlyNotebookNameAndHeadingWithoutInventingPage() throws Exception {
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(BASE));
        String comment = DigestProtocol.manualComment(p, "A thought");

        assertTrue(comment.startsWith("Note: A thought\n\nSource: Satsang/2610 | Heading: Reflection"));
        assertFalse(comment.contains("Page:"));
        assertFalse(comment.contains("obsidian://"));
        assertFalse(comment.contains("Satsang/2610.md"));
    }

    @Test public void plainMarkdownWithoutHeadingKeepsFriendlyNameAndOmitsPageAndHeadingPlaceholders() throws Exception {
        String json = BASE.replace(",\"heading\":\"Reflection\"", "");
        String comment = DigestProtocol.manualComment(DigestProtocol.parseDeepLink(link(json)));
        assertEquals("Source: Satsang/2610", comment);
        assertFalse(comment.contains("Page:"));
        assertFalse(comment.contains("Heading:"));
    }

    @Test public void legacySavedReceiptFallbackKeepsExactPreProvenanceCommentFormat() throws Exception {
        DigestProtocol.DigestPayload markdown = DigestProtocol.parseDeepLink(link(BASE));
        assertEquals("Obsidian: Satsang/2610.md\nobsidian://open?vault=Vedas&file=Satsang%2F2610.md",
                DigestProtocol.legacyManualComment(markdown));

        String json = BASE.substring(0, BASE.length() - 1)
                + ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/Reflection.note\",\"page\":9,\"fileId\":\"file-id\",\"pageId\":\"native:P-fixture-page-9\"}}";
        DigestProtocol.DigestPayload supernote = DigestProtocol.parseDeepLink(link(json));
        assertEquals("Supernote: Reflection.note · page 9\nObsidian: Satsang/2610.md\nobsidian://open?vault=Vedas&file=Satsang%2F2610.md",
                DigestProtocol.legacyManualComment(supernote));
        assertNotEquals(DigestProtocol.legacyManualComment(supernote), DigestProtocol.manualComment(supernote, ""));
        String exactStoredComment = "Note: preserved old note\n\nSupernote: Reflection.note · page 9\nObsidian: Satsang/2610.md\nold-link";
        assertEquals(exactStoredComment, DigestProtocol.savedReceiptComment(supernote, exactStoredComment));
        assertEquals(DigestProtocol.legacyManualComment(supernote), DigestProtocol.savedReceiptComment(supernote, null));
    }

    @Test public void notebookCommentLimitIncludesFriendlyProvenanceAndKeepsUserNoteBounded() throws Exception {
        String json = BASE.substring(0, BASE.length() - 1)
                + ",\"note\":{\"path\":\"/storage/emulated/0/Note/Book/Reflection.note\",\"page\":9,\"fileId\":\"file-id\",\"pageId\":\"native:P-fixture-page-9\"}}";
        DigestProtocol.DigestPayload p = DigestProtocol.parseDeepLink(link(json));
        String comment = DigestProtocol.manualComment(p, repeat('n', 1700));
        assertTrue(comment.length() <= 2000);
        assertTrue(comment.contains("Book/Reflection | Page 9"));
        try { DigestProtocol.manualComment(p, repeat('n', 2000)); fail("Expected comment bound"); }
        catch (DigestProtocol.InvalidPayloadException expected) { assertEquals("comment length", expected.reason); }
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

    @Test public void reviewAndQuickEnvelopeKeepPayloadIdentityUnchanged() throws Exception {
        String client = repeat('b', 32), secretHex = repeat('c', 64);
        byte[] secret = DigestProtocol.parseHexSecret(secretHex);
        long now = 1792291200000L;
        String signature = DigestProtocol.quickSignature(client, now, BASE, secret);
        String review = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=review";
        String quick = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=quick&client=" + client
                + "&time=" + now + "&signature=" + signature + "&setup=" + secretHex;
        DigestProtocol.RequestEnvelope reviewEnvelope = DigestProtocol.parseEnvelope(review);
        DigestProtocol.RequestEnvelope quickEnvelope = DigestProtocol.parseEnvelope(quick);
        assertEquals(DigestProtocol.RequestMode.REVIEW, reviewEnvelope.mode);
        assertEquals(DigestProtocol.RequestMode.QUICK, quickEnvelope.mode);
        assertEquals(BASE, quickEnvelope.payload.rawJson);
        assertEquals(reviewEnvelope.payload.requestId, quickEnvelope.payload.requestId);
        assertEquals(sha256(reviewEnvelope.payload.rawJson), sha256(quickEnvelope.payload.rawJson));
        assertTrue(DigestProtocol.quickSignatureMatches(client, now, BASE, secret, signature));
        assertFalse(DigestProtocol.quickSignatureMatches(client, now, BASE + " ", secret, signature));
        assertFalse(DigestProtocol.quickSignatureMatches(client, now, BASE, secret, repeat('d', 64)));
    }

    @Test public void signedDeliveryOptionsPreservePayloadIdentityAndBindRoutingAndCategory() throws Exception {
        String client = repeat('b', 32), secretHex = repeat('c', 64), time = "1792291200000";
        byte[] secret = DigestProtocol.parseHexSecret(secretHex);
        String delivery = "{\"openNative\":false,\"categoryName\":\"Study Notes\"}";
        String signature = DigestProtocol.quickSignature(client, Long.parseLong(time), BASE, secret, delivery);
        assertEquals("ec5426dee0a752cd78da56a324114a47c0e345e34020b38d673b7ca690473898", signature);
        String quick = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=quick&client=" + client
                + "&time=" + time + "&signature=" + signature + "&setup=" + secretHex + "&delivery=" + encode(delivery);

        DigestProtocol.RequestEnvelope parsed = DigestProtocol.parseEnvelope(quick);
        assertEquals(BASE, parsed.payload.rawJson);
        assertEquals(ID, parsed.payload.requestId);
        assertFalse(parsed.shouldOpenNative());
        assertEquals("Study Notes", parsed.categoryName());
        assertEquals(delivery, parsed.rawDeliveryJson);
        assertTrue(DigestProtocol.quickSignatureMatches(client, Long.parseLong(time), BASE, secret, delivery, signature));

        String changedDelivery = delivery.replace("Study Notes", "Another list");
        assertFalse(DigestProtocol.quickSignatureMatches(client, Long.parseLong(time), BASE, secret, changedDelivery, signature));
        String strippedDelivery = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=quick&client=" + client
                + "&time=" + time + "&signature=" + signature + "&setup=" + secretHex;
        assertFalse(DigestProtocol.quickSignatureMatches(client, Long.parseLong(time), BASE, secret, null, signature));
        assertTrue(DigestProtocol.parseEnvelope(strippedDelivery).shouldOpenNative());

        String legacySignature = DigestProtocol.quickSignature(client, Long.parseLong(time), BASE, secret);
        assertEquals(legacySignature, DigestProtocol.quickSignature(client, Long.parseLong(time), BASE, secret, null));
        assertTrue(DigestProtocol.quickSignatureMatches(client, Long.parseLong(time), BASE, secret, legacySignature));
    }

    @Test public void deliverySupportsExplicitUncategorizedAndDefaultsOpenForLegacy() throws Exception {
        String client = repeat('b', 32), secretHex = repeat('c', 64), time = "1792291200000";
        byte[] secret = DigestProtocol.parseHexSecret(secretHex);
        String delivery = "{\"openNative\":true,\"categoryName\":\"\"}";
        String signature = DigestProtocol.quickSignature(client, Long.parseLong(time), BASE, secret, delivery);
        String quick = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=quick&client=" + client
                + "&time=" + time + "&signature=" + signature + "&setup=" + secretHex + "&delivery=" + encode(delivery);
        DigestProtocol.RequestEnvelope parsed = DigestProtocol.parseEnvelope(quick);
        assertTrue(parsed.shouldOpenNative());
        assertEquals("", parsed.categoryName());
    }

    @Test public void deliveryRejectsMalformedFieldsAndIsQuickOnly() throws Exception {
        String client = repeat('b', 32), secretHex = repeat('c', 64), time = "1792291200000";
        byte[] secret = DigestProtocol.parseHexSecret(secretHex);
        String valid = "{\"openNative\":false}";
        String signature = DigestProtocol.quickSignature(client, Long.parseLong(time), BASE, secret, valid);
        String prefix = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=quick&client=" + client
                + "&time=" + time + "&signature=" + signature + "&setup=" + secretHex + "&delivery=";
        rejects(prefix + encode("{\"openNative\":\"false\"}"));
        rejects(prefix + encode("{\"openNative\":false,\"extra\":1}"));
        rejects(prefix + encode("{\"categoryName\":\"Study\"}"));
        rejects(prefix + encode("{\"openNative\":false,\"openNative\":true}"));
        String review = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=review&delivery=" + encode(valid);
        rejects(review);
        rejects(prefix + encode(repeat('x', DigestProtocol.MAX_DELIVERY_JSON_LENGTH + 1)));
    }

    @Test public void quickEnvelopeRejectsUnknownDuplicateAndMalformedFields() throws Exception {
        String client = repeat('b', 32), secretHex = repeat('c', 64), time = "1792291200000";
        byte[] secret = DigestProtocol.parseHexSecret(secretHex);
        String signature = DigestProtocol.quickSignature(client, Long.parseLong(time), BASE, secret);
        String quick = "supernote-bridge://digest?payload=" + encode(BASE) + "&mode=quick&client=" + client
                + "&time=" + time + "&signature=" + signature + "&setup=" + secretHex;
        rejects(quick + "&extra=x");
        rejects(quick + "&client=" + client);
        rejects(quick.replace("&time=" + time, "&time=-1"));
        rejects(quick.replace("&setup=" + secretHex, "&setup=" + repeat('G', 64)));
        try { DigestProtocol.parseHexSecret("short"); fail("Expected invalid setup secret"); }
        catch (DigestProtocol.InvalidPayloadException expected) { }
    }

    @Test public void quickSignatureMatchesIndependentUnicodeKnownAnswer() throws Exception {
        byte[] secret = DigestProtocol.parseHexSecret("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20");
        String client = "0123456789abcdef0123456789abcdef";
        long timestamp = 1792291200000L;
        String rawJson = "{\"text\":\"synthetic नमस्ते\"}";
        assertEquals("2c63fbce6fd7812c95149fb1948bcfdd2040e5d2261bf16cdee5e5e932715206",
                DigestProtocol.quickSignature(client, timestamp, rawJson, secret));
    }

    @Test public void quickTimestampWindowIsFiveMinutesOnEitherSide() {
        long now = 1792291200000L;
        assertTrue(DigestProtocol.isTimestampFresh(now, now - 300000));
        assertTrue(DigestProtocol.isTimestampFresh(now, now + 300000));
        assertFalse(DigestProtocol.isTimestampFresh(now, now - 300001));
        assertFalse(DigestProtocol.isTimestampFresh(now, now + 300001));
    }

    @Test public void newReceiptsEnforceListButLegacyReceiptsSkipIt() {
        assertTrue(DigestProtocol.listAssociationMatches(null, "legacy-provider-default", false));
        assertTrue(DigestProtocol.listAssociationMatches("list-a", "list-a", true));
        assertFalse(DigestProtocol.listAssociationMatches("list-a", "list-b", true));
        assertTrue(DigestProtocol.listAssociationMatches(null, null, true));
        assertTrue(DigestProtocol.listAssociationMatches(null, "", true));
        assertFalse(DigestProtocol.listAssociationMatches(null, "list-a", true));
    }

    @Test public void listDisplayNameUsesSafeFallbackAndWhitespaceNormalization() {
        DigestProtocol.ListDisplayName blankDefault = DigestProtocol.normalizeListDisplayName(" \t\n ", true);
        assertEquals("Uncategorized", blankDefault.value);
        assertEquals("name_blank_default_fallback", blankDefault.problem);
        DigestProtocol.ListDisplayName multiline = DigestProtocol.normalizeListDisplayName("  Study\n Notes\tToday  ", false);
        assertEquals("Study Notes Today", multiline.value);
        assertNull(multiline.problem);
        assertNull(DigestProtocol.normalizeListDisplayName("\n\t", false).value);
    }

    @Test public void listDisplayNameTruncatesAndRejectsUnsafeUnicode() {
        DigestProtocol.ListDisplayName longName = DigestProtocol.normalizeListDisplayName(repeat('x', 400), false);
        assertEquals(256, longName.value.length());
        assertTrue(longName.value.endsWith("…"));
        assertEquals("name_truncated", longName.problem);
        assertEquals("name_control", DigestProtocol.normalizeListDisplayName("Valid\u0001Name", false).problem);
        assertEquals("name_unpaired_surrogate", DigestProtocol.normalizeListDisplayName("Bad\uD800", false).problem);
    }

    @Test public void listIdentityKeepsOnlyKnownDefaultAndBoundNondefaultAssociations() {
        assertTrue(DigestProtocol.isValidListChoiceIdentity(0, null));
        assertTrue(DigestProtocol.isValidListChoiceIdentity(0, ""));
        assertFalse(DigestProtocol.isValidListChoiceIdentity(0, "unexpected"));
        assertFalse(DigestProtocol.isValidListChoiceIdentity(-1, "known"));
        assertFalse(DigestProtocol.isValidListChoiceIdentity(3, null));
        assertFalse(DigestProtocol.isValidListChoiceIdentity(3, ""));
        assertFalse(DigestProtocol.isValidListChoiceIdentity(3, repeat('a', 257)));
        assertTrue(DigestProtocol.isValidListChoiceIdentity(3, "exact-unique-attribute"));
    }

    private static void rejects(String uri) {
        try { DigestProtocol.parseDeepLink(uri); fail("Expected invalid URI"); }
        catch (DigestProtocol.InvalidPayloadException expected) { }
    }
    private static String link(String json) { return "supernote-bridge://digest?payload=" + encode(json); }
    private static String sha256(String value) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder(64); for (byte b : bytes) result.append(String.format(Locale.ROOT, "%02x", b & 0xff)); return result.toString();
    }
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

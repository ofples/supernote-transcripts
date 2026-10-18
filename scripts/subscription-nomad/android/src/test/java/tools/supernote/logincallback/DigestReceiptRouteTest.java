package tools.supernote.logincallback;

import org.junit.Test;

import static org.junit.Assert.*;

public final class DigestReceiptRouteTest {
    private static final String REQUEST = repeat('a', 64);

    @Test public void acceptsOnlyTheFixedReceiptRouteAndPositiveKnownIdShape() throws Exception {
        DigestReceiptRoute.Request request = DigestReceiptRoute.parse(
                "supernote-bridge://digest-receipt?request=" + REQUEST + "&id=123");
        assertEquals(REQUEST, request.requestId);
        assertEquals(123L, request.assertedId);

        DigestReceiptRoute.Request reverseOrder = DigestReceiptRoute.parse(
                "supernote-bridge://digest-receipt?id=9223372036854775807&request=" + REQUEST);
        assertEquals(Long.MAX_VALUE, reverseOrder.assertedId);
    }

    @Test public void rejectsWrongUriTargetsAndComponents() {
        rejects("https://digest-receipt?request=" + REQUEST + "&id=1");
        rejects("supernote-bridge://digest?request=" + REQUEST + "&id=1");
        rejects("supernote-bridge://user@digest-receipt?request=" + REQUEST + "&id=1");
        rejects("supernote-bridge://digest-receipt:443?request=" + REQUEST + "&id=1");
        rejects("supernote-bridge://digest-receipt/path?request=" + REQUEST + "&id=1");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=1#fragment");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=1&other=x");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&request=" + REQUEST + "&id=1");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=1&id=1");
    }

    @Test public void rejectsMissingMalformedOrNoncanonicalParameters() {
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST);
        rejects("supernote-bridge://digest-receipt?id=1");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST.toUpperCase(java.util.Locale.ROOT) + "&id=1");
        rejects("supernote-bridge://digest-receipt?request=%" + REQUEST.substring(1) + "&id=1");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=0");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=01");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=+1");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=9223372036854775808");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=1=2");
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=");
    }

    @Test public void rejectsOversizedUri() {
        rejects("supernote-bridge://digest-receipt?request=" + REQUEST + "&id=1" + repeat('x', 200));
    }

    @Test public void opensOnlyTheExactPositiveIdFromASavedReceipt() {
        assertEquals(123L, DigestReceiptRoute.authorizedSavedId("SAVED", 123L, 123L));
        assertEquals(-1L, DigestReceiptRoute.authorizedSavedId("PENDING", 123L, 123L));
        assertEquals(-1L, DigestReceiptRoute.authorizedSavedId("UNCERTAIN", 123L, 123L));
        assertEquals(-1L, DigestReceiptRoute.authorizedSavedId("CANCELLED", 123L, 123L));
        assertEquals(-1L, DigestReceiptRoute.authorizedSavedId("SAVED", 123L, 124L));
        assertEquals(-1L, DigestReceiptRoute.authorizedSavedId("SAVED", -1L, 123L));
        assertEquals(-1L, DigestReceiptRoute.authorizedSavedId("SAVED", 123L, 0L));
        assertEquals(-1L, DigestReceiptRoute.authorizedSavedId(null, 123L, 123L));
    }

    private static void rejects(String uri) {
        try { DigestReceiptRoute.parse(uri); fail("Expected invalid receipt route"); }
        catch (DigestReceiptRoute.InvalidRouteException expected) { }
    }

    private static String repeat(char c, int count) {
        char[] chars = new char[count]; java.util.Arrays.fill(chars, c); return new String(chars);
    }
}

package tools.supernote.logincallback;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.HashMap;
import java.util.Map;

/** Strict route for opening an existing locally saved Digest. */
final class DigestReceiptRoute {
    static final int MAX_URI_LENGTH = 256;
    private static final String SCHEME = "supernote-bridge";
    private static final String AUTHORITY = "digest-receipt";

    private DigestReceiptRoute() { }

    static Request parse(String rawUri) throws InvalidRouteException {
        if (rawUri == null || rawUri.length() > MAX_URI_LENGTH) throw invalid();
        final URI uri;
        try { uri = new URI(rawUri); }
        catch (URISyntaxException ignored) { throw invalid(); }
        if (!SCHEME.equals(uri.getScheme()) || !AUTHORITY.equals(uri.getRawAuthority())
                || uri.getRawUserInfo() != null || uri.getPort() != -1
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty())
                || uri.getRawFragment() != null) throw invalid();

        String rawQuery = uri.getRawQuery();
        if (rawQuery == null || rawQuery.isEmpty()) throw invalid();
        String[] pairs = rawQuery.split("&", -1);
        if (pairs.length < 1 || pairs.length > 2) throw invalid();
        Map<String, String> query = new HashMap<>();
        for (String pair : pairs) {
            int equals = pair.indexOf('=');
            if (equals <= 0 || equals != pair.lastIndexOf('=')) throw invalid();
            String key = pair.substring(0, equals);
            String value = pair.substring(equals + 1);
            if ((!"request".equals(key) && !"id".equals(key)) || value.isEmpty()
                    || query.put(key, value) != null) throw invalid();
        }
        String requestId = query.get("request");
        String idText = query.get("id");
        if (requestId == null || !requestId.matches("[0-9a-f]{64}")) throw invalid();
        long assertedId = -1L;
        if (idText != null) {
            if (!idText.matches("[1-9][0-9]{0,18}")) throw invalid();
            try { assertedId = Long.parseLong(idText); }
            catch (NumberFormatException ignored) { throw invalid(); }
            if (assertedId <= 0) throw invalid();
        }
        return new Request(requestId, assertedId);
    }

    /** Resolves a local SAVED ID, checking the Reader assertion when one is supplied. */
    static long authorizedSavedId(String status, long savedId, long assertedId) {
        return "SAVED".equals(status) && savedId > 0 && (assertedId == -1L || savedId == assertedId)
                ? savedId : -1L;
    }

    private static InvalidRouteException invalid() { return new InvalidRouteException(); }

    static final class Request {
        final String requestId;
        final long assertedId;
        Request(String requestId, long assertedId) { this.requestId = requestId; this.assertedId = assertedId; }
    }

    static final class InvalidRouteException extends Exception { }
}

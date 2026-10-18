package tools.supernote.logincallback;

import java.io.ByteArrayOutputStream;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Strict, Android-independent parser and validator for the external Digest request contract. */
final class DigestProtocol {
    static final int MAX_ENCODED_URI_LENGTH = 150 * 1024;
    static final int MAX_DECODED_JSON_LENGTH = 40 * 1024;
    static final int MAX_TEXT_LENGTH = 15000;
    static final int MAX_METADATA_LENGTH = 16 * 1024;
    static final String NOTE_ROOT = "/storage/emulated/0/Note";

    private static final String DIGEST_SCHEME = "supernote-bridge";
    private static final String DIGEST_AUTHORITY = "digest";
    private static final String PROVIDER_AUTHORITY = "com.ratta.supernote.knowledge.provider";
    private static final String QUICK_MAC_PREFIX = "supernote-bridge-quick-v1\n";

    private DigestProtocol() {}

    static DigestPayload parseDeepLink(String rawUri) throws InvalidPayloadException {
        return parseEnvelope(rawUri).payload;
    }

    static RequestEnvelope parseEnvelope(String rawUri) throws InvalidPayloadException {
        if (rawUri == null || rawUri.length() > MAX_ENCODED_URI_LENGTH) throw invalid("URI length");
        final URI uri;
        try {
            uri = new URI(rawUri);
        } catch (URISyntaxException ignored) {
            throw invalid("URI syntax");
        }
        if (!DIGEST_SCHEME.equals(uri.getScheme())
                || !DIGEST_AUTHORITY.equals(uri.getRawAuthority())
                || uri.getRawUserInfo() != null
                || uri.getPort() != -1
                || (uri.getRawPath() != null && !uri.getRawPath().isEmpty())
                || uri.getRawFragment() != null) {
            throw invalid("URI target");
        }
        Map<String, String> query = parseQuery(uri.getRawQuery());
        if (!query.containsKey("payload")) throw invalid("URI query");
        String modeValue = query.getOrDefault("mode", "review");
        RequestMode mode;
        if ("review".equals(modeValue)) mode = RequestMode.REVIEW;
        else if ("quick".equals(modeValue)) mode = RequestMode.QUICK;
        else throw invalid("mode");
        if (mode == RequestMode.REVIEW) {
            for (String key : query.keySet()) if (!"payload".equals(key) && !"mode".equals(key)) throw invalid("review envelope field");
        } else {
            for (String key : query.keySet()) if (!"payload".equals(key) && !"mode".equals(key)
                    && !"client".equals(key) && !"time".equals(key) && !"signature".equals(key) && !"setup".equals(key)) throw invalid("quick envelope field");
        }
        String json = strictDecodeComponent(query.get("payload"));
        if (json.length() > MAX_DECODED_JSON_LENGTH) throw invalid("JSON length");
        Object root = new JsonParser(json).parse();
        Map<String, Object> object = object(root);
        requireOnlyKeys(object, "version", "requestId", "text", "origin", "note");
        requireKeys(object, "version", "requestId", "text", "origin");

        if (longValue(object.get("version")) != 1L) throw invalid("version");
        String requestId = string(object.get("requestId"));
        if (!requestId.matches("[0-9a-f]{64}")) throw invalid("requestId");
        String text = string(object.get("text"));
        if (text.isEmpty() || text.length() > MAX_TEXT_LENGTH || hasDisallowedControl(text, true)) {
            throw invalid("text");
        }

        Origin origin = parseOrigin(object(object.get("origin")));
        Note note = object.containsKey("note") ? parseNote(object(object.get("note"))) : null;
        DigestPayload payload = new DigestPayload(json, requestId, text, origin, note);
        String client = query.get("client"), timeText = query.get("time"), signature = query.get("signature"), setup = query.get("setup");
        long time = -1;
        if (mode == RequestMode.QUICK) {
            if (client == null || !client.matches("[0-9a-f]{32}") || timeText == null || !timeText.matches("0|[1-9][0-9]{0,15}")
                    || signature == null || !signature.matches("[0-9a-f]{64}")
                    || (setup != null && !setup.matches("[0-9a-f]{64}"))) throw invalid("quick signature fields");
            try { time = Long.parseLong(timeText); } catch (NumberFormatException ignored) { throw invalid("quick timestamp"); }
        }
        return new RequestEnvelope(payload, mode, client, time, signature, setup);
    }

    private static Map<String, String> parseQuery(String raw) throws InvalidPayloadException {
        if (raw == null || raw.isEmpty()) throw invalid("URI query");
        Map<String, String> result = new LinkedHashMap<>();
        String[] parts = raw.split("&", -1);
        if (parts.length > 6) throw invalid("URI query count");
        for (String part : parts) {
            int equals = part.indexOf('=');
            if (equals <= 0 || equals != part.lastIndexOf('=')) throw invalid("URI query pair");
            String key = part.substring(0, equals);
            String value = part.substring(equals + 1);
            if (!key.matches("[a-z]+") || result.put(key, value) != null) throw invalid("URI query key");
        }
        return result;
    }

    static String quickSignature(String client, long time, String rawJson, byte[] secret) throws Exception {
        if (client == null || !client.matches("[0-9a-f]{32}") || time < 0 || rawJson == null || secret == null || secret.length != 32)
            throw new IllegalArgumentException("quick signature input");
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret, "HmacSHA256"));
        byte[] digest = mac.doFinal((QUICK_MAC_PREFIX + client + "\n" + time + "\n" + rawJson).getBytes(StandardCharsets.UTF_8));
        StringBuilder out = new StringBuilder(64);
        for (byte b : digest) out.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return out.toString();
    }

    static boolean quickSignatureMatches(String client, long time, String rawJson, byte[] secret, String supplied) {
        try { return supplied != null && MessageDigest.isEqual(quickSignature(client, time, rawJson, secret).getBytes(StandardCharsets.US_ASCII), supplied.getBytes(StandardCharsets.US_ASCII)); }
        catch (Exception ignored) { return false; }
    }

    static byte[] parseHexSecret(String hex) throws InvalidPayloadException {
        if (hex == null || !hex.matches("[0-9a-f]{64}")) throw invalid("quick setup secret");
        byte[] result = new byte[32];
        for (int i = 0; i < result.length; i++) result[i] = (byte) ((hex(hex.charAt(i * 2)) << 4) | hex(hex.charAt(i * 2 + 1)));
        return result;
    }

    static boolean isTimestampFresh(long now, long timestamp) {
        return timestamp >= now - 5 * 60 * 1000L && timestamp <= now + 5 * 60 * 1000L;
    }

    static boolean listAssociationMatches(String expected, String actual, boolean enforce) {
        if (!enforce) return true;
        return expected == null ? actual == null || actual.isEmpty() : expected.equals(actual);
    }

    static ListDisplayName normalizeListDisplayName(String raw, boolean isDefault) {
        if (raw == null) return new ListDisplayName(isDefault ? "Uncategorized" : null, isDefault ? "name_blank_default_fallback" : "name_blank");
        final int inputLimit = Math.min(raw.length(), 4096);
        int end = inputLimit;
        if (raw.length() > inputLimit && end > 0 && Character.isHighSurrogate(raw.charAt(end - 1))) end--;
        StringBuilder normalized = new StringBuilder(Math.min(end, 256));
        boolean pendingSpace = false;
        for (int i = 0; i < end;) {
            char ch = raw.charAt(i);
            if (Character.isHighSurrogate(ch)) {
                if (i + 1 >= end || !Character.isLowSurrogate(raw.charAt(i + 1))) return new ListDisplayName(null, "name_unpaired_surrogate");
            } else if (Character.isLowSurrogate(ch)) return new ListDisplayName(null, "name_unpaired_surrogate");
            int cp = raw.codePointAt(i);
            i += Character.charCount(cp);
            if (Character.isISOControl(cp) && !Character.isWhitespace(cp)) return new ListDisplayName(null, "name_control");
            if (Character.isWhitespace(cp) || Character.isSpaceChar(cp) || Character.isISOControl(cp)) {
                pendingSpace = normalized.length() > 0;
                continue;
            }
            if (pendingSpace) normalized.append(' ');
            pendingSpace = false;
            normalized.appendCodePoint(cp);
        }
        String display = normalized.toString();
        if (display.isEmpty()) return new ListDisplayName(isDefault ? "Uncategorized" : null, isDefault ? "name_blank_default_fallback" : "name_blank");
        boolean truncated = raw.length() > end || display.length() > 256;
        if (display.length() > 256) {
            int cut = 255;
            if (cut > 0 && Character.isHighSurrogate(display.charAt(cut - 1))) cut--;
            display = display.substring(0, cut) + "…";
        }
        return new ListDisplayName(display, truncated ? "name_truncated" : null);
    }

    static boolean isValidListChoiceIdentity(long id, String attribute) {
        if (id < 0) return false;
        if (id == 0) return attribute == null || attribute.isEmpty();
        if (attribute == null || attribute.isEmpty() || attribute.length() > 256) return false;
        for (int i = 0; i < attribute.length(); i++) {
            char ch = attribute.charAt(i);
            if (Character.isISOControl(ch)) return false;
            if (Character.isHighSurrogate(ch)) {
                if (i + 1 >= attribute.length() || !Character.isLowSurrogate(attribute.charAt(i + 1))) return false;
                i++;
            } else if (Character.isLowSurrogate(ch)) return false;
        }
        return true;
    }

    static String strictDecodeComponent(String value) throws InvalidPayloadException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(value.length());
        for (int i = 0; i < value.length();) {
            char c = value.charAt(i);
            if (c == '%') {
                if (i + 2 >= value.length()) throw invalid("percent encoding");
                int hi = hex(value.charAt(i + 1));
                int lo = hex(value.charAt(i + 2));
                if (hi < 0 || lo < 0) throw invalid("percent encoding");
                bytes.write((hi << 4) | lo);
                i += 3;
            } else {
                if (!isEncodeURIComponentUnescaped(c)) throw invalid("unescaped URI character");
                bytes.write((byte) c);
                i++;
            }
        }
        try {
            return StandardCharsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes.toByteArray())).toString();
        } catch (CharacterCodingException ignored) {
            throw invalid("UTF-8");
        }
    }

    static long parseProviderAcknowledgement(String rawUri) {
        if (rawUri == null) return -1L;
        final URI uri;
        try {
            uri = new URI(rawUri);
        } catch (URISyntaxException ignored) {
            return -1L;
        }
        if (!"content".equals(uri.getScheme())
                || !PROVIDER_AUTHORITY.equals(uri.getRawAuthority())
                || uri.getRawUserInfo() != null
                || uri.getPort() != -1
                || uri.getRawQuery() != null
                || uri.getRawFragment() != null) return -1L;
        String path = uri.getRawPath();
        if (path == null) return -1L;
        String idText;
        if (path.matches("/knowledge/[0-9]+")) {
            idText = path.substring("/knowledge/".length());
        } else if (path.matches("/knowledge/insert/[0-9]+")) {
            idText = path.substring("/knowledge/insert/".length());
        } else {
            return -1L;
        }
        try {
            long id = Long.parseLong(idText);
            return id > 0 ? id : -1L;
        } catch (NumberFormatException ignored) {
            return -1L;
        }
    }

    static String validateNotePathLexically(String path) throws InvalidPayloadException {
        if (path == null || path.isEmpty() || path.length() > 4096 || !path.startsWith(NOTE_ROOT + "/")
                || path.indexOf('\\') >= 0 || hasDisallowedControl(path, false)) throw invalid("note path");
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.contains("%2e") || lower.contains("%2f") || lower.contains("%5c")
                || !lower.endsWith(".note")) throw invalid("note path");
        String[] segments = path.split("/", -1);
        for (int i = 1; i < segments.length; i++) {
            if (segments[i].isEmpty() || ".".equals(segments[i]) || "..".equals(segments[i])) throw invalid("note path");
        }
        return path;
    }

    static String validateCanonicalNotePath(String canonicalPath) throws InvalidPayloadException {
        validateNotePathLexically(canonicalPath);
        if (!canonicalPath.startsWith(NOTE_ROOT + "/")) throw invalid("canonical note path");
        return canonicalPath;
    }

    static String manualComment(DigestPayload payload) throws InvalidPayloadException {
        return manualComment(payload, "");
    }

    static String manualComment(DigestPayload payload, String userNote) throws InvalidPayloadException {
        if (userNote == null) userNote = "";
        String uri = "obsidian://open?vault=" + encodeQuery(payload.origin.vault)
                + "&file=" + encodeQuery(payload.origin.file);
        StringBuilder comment = new StringBuilder();
        if (!userNote.trim().isEmpty()) comment.append("Note: ").append(userNote.trim()).append("\n\n");
        if (payload.note != null) comment.append("Supernote: ").append(fileName(payload.note.path))
                .append(" · page ").append(payload.note.page).append('\n');
        comment.append("Obsidian: ").append(payload.origin.file).append('\n').append(uri);
        if (comment.length() > 2000) throw invalid("comment length");
        return comment.toString();
    }

    static String metadataJson(DigestPayload payload) throws InvalidPayloadException {
        StringBuilder out = new StringBuilder("{\"supernote_bridge\":{\"origin\":{");
        appendJsonField(out, "vault", payload.origin.vault, false);
        appendJsonField(out, "file", payload.origin.file, true);
        if (payload.origin.heading != null) appendJsonField(out, "heading", payload.origin.heading, true);
        if (payload.origin.before != null) appendJsonField(out, "before", payload.origin.before, true);
        if (payload.origin.after != null) appendJsonField(out, "after", payload.origin.after, true);
        out.append('}');
        if (payload.note != null) {
            out.append(",\"note\":{");
            appendJsonField(out, "path", payload.note.path, false);
            appendJsonField(out, "page", Integer.toString(payload.note.page), true);
            appendJsonField(out, "fileId", payload.note.fileId, true);
            appendJsonField(out, "pageId", payload.note.pageId, true);
            out.append(",\"pageIds\":[");
            for (int i = 0; i < payload.note.pageIds.size(); i++) {
                if (i > 0) out.append(',');
                appendJsonString(out, payload.note.pageIds.get(i));
            }
            out.append("]}");
        }
        out.append("}}");
        if (out.length() > MAX_METADATA_LENGTH) throw invalid("provider metadata limit");
        return out.toString();
    }

    private static String fileName(String path) {
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    /** Compares every expected field; only a provider-generated root unique_identifier may be added. */
    static boolean metadataMatches(DigestPayload payload, String actualJson) {
        try {
            Map<String, Object> expected = object(new JsonParser(metadataJson(payload)).parse());
            Map<String, Object> actual = object(new JsonParser(actualJson).parse());
            boolean hasGeneratedId = actual.containsKey("unique_identifier");
            if (hasGeneratedId) {
                Object value = actual.get("unique_identifier");
                if (!(value instanceof String) || !((String) value).matches("[0-9a-fA-F]{32}")) return false;
            }
            if (actual.size() != expected.size() + (hasGeneratedId ? 1 : 0)) return false;
            for (Map.Entry<String, Object> entry : expected.entrySet()) {
                if (!actual.containsKey(entry.getKey()) || !entry.getValue().equals(actual.get(entry.getKey()))) return false;
            }
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void appendJsonField(StringBuilder out, String key, String value, boolean comma) {
        if (comma) out.append(',');
        appendJsonString(out, key);
        out.append(':');
        appendJsonString(out, value);
    }

    private static void appendJsonString(StringBuilder out, String value) {
        out.append('"');
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"': out.append("\\\""); break;
                case '\\': out.append("\\\\"); break;
                case '\b': out.append("\\b"); break;
                case '\f': out.append("\\f"); break;
                case '\n': out.append("\\n"); break;
                case '\r': out.append("\\r"); break;
                case '\t': out.append("\\t"); break;
                default:
                    if (c < 0x20) {
                        out.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        out.append(c);
                    }
            }
        }
        out.append('"');
    }

    private static String encodeQuery(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8").replace("+", "%20");
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private static Origin parseOrigin(Map<String, Object> object) throws InvalidPayloadException {
        requireOnlyKeys(object, "vault", "file", "heading", "before", "after");
        requireKeys(object, "vault", "file");
        String vault = boundedString(object.get("vault"), 1, 256, false);
        String file = boundedString(object.get("file"), 1, 2048, false);
        validateOriginFile(file);
        String heading = optionalBoundedString(object, "heading", 256);
        String before = optionalBoundedString(object, "before", 240);
        String after = optionalBoundedString(object, "after", 240);
        return new Origin(vault, file, heading, before, after);
    }

    private static Note parseNote(Map<String, Object> object) throws InvalidPayloadException {
        requireOnlyKeys(object, "path", "page", "fileId", "pageId", "pageIds");
        requireKeys(object, "path", "page", "fileId", "pageId");
        String path = string(object.get("path"));
        validateNotePathLexically(path);
        long page = longValue(object.get("page"));
        if (page < 1 || page > 100000) throw invalid("note page");
        String fileId = boundedString(object.get("fileId"), 1, 256, false);
        String pageId = boundedString(object.get("pageId"), 8, 256, false);
        if (!pageId.startsWith("native:")) throw invalid("native page identifier prefix");
        List<Object> rawIds = object.containsKey("pageIds") ? array(object.get("pageIds")) : new ArrayList<>();
        if (!object.containsKey("pageIds")) rawIds.add(pageId);
        if (rawIds.isEmpty() || rawIds.size() > 100) throw invalid("note pageIds");
        List<String> pageIds = new ArrayList<>();
        Set<String> unique = new HashSet<>();
        for (Object rawId : rawIds) {
            String id = boundedString(rawId, 8, 256, false);
            if (!id.startsWith("native:")) throw invalid("native page ID prefix");
            if (!unique.add(id)) throw invalid("duplicate note ID");
            pageIds.add(id);
        }
        if (!pageId.equals(pageIds.get(0))) throw invalid("primary note ID");
        return new Note(path, (int) page, fileId, pageId, pageIds);
    }

    private static void validateOriginFile(String file) throws InvalidPayloadException {
        if (file.startsWith("/") || file.indexOf('\\') >= 0 || file.indexOf(':') >= 0
                || !file.toLowerCase(Locale.ROOT).endsWith(".md")) throw invalid("origin file");
        String[] segments = file.split("/", -1);
        for (String segment : segments) {
            if (segment.isEmpty() || ".".equals(segment) || "..".equals(segment)) throw invalid("origin file");
        }
        String lower = file.toLowerCase(Locale.ROOT);
        if (lower.contains("%2f") || lower.contains("%5c")) throw invalid("origin file");
    }

    private static String optionalBoundedString(Map<String, Object> object, String key, int max) throws InvalidPayloadException {
        if (!object.containsKey(key)) return null;
        return boundedString(object.get(key), 0, max, false);
    }

    private static String boundedString(Object value, int min, int max, boolean allowTextControls) throws InvalidPayloadException {
        String result = string(value);
        if (result.length() < min || result.length() > max || hasDisallowedControl(result, allowTextControls)) {
            throw invalid("string bounds");
        }
        return result;
    }

    private static boolean hasDisallowedControl(String value, boolean allowNewlineAndTab) throws InvalidPayloadException {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(i + 1))) throw invalid("surrogate");
                i++;
                continue;
            }
            if (Character.isLowSurrogate(c)) throw invalid("surrogate");
            if (Character.isISOControl(c) && !(allowNewlineAndTab && (c == '\n' || c == '\t'))) return true;
        }
        return false;
    }

    private static Map<String, Object> object(Object value) throws InvalidPayloadException {
        if (!(value instanceof Map)) throw invalid("object expected");
        @SuppressWarnings("unchecked") Map<String, Object> result = (Map<String, Object>) value;
        return result;
    }

    private static List<Object> array(Object value) throws InvalidPayloadException {
        if (!(value instanceof List)) throw invalid("array expected");
        @SuppressWarnings("unchecked") List<Object> result = (List<Object>) value;
        return result;
    }

    private static String string(Object value) throws InvalidPayloadException {
        if (!(value instanceof String)) throw invalid("string expected");
        return (String) value;
    }

    private static long longValue(Object value) throws InvalidPayloadException {
        if (!(value instanceof Long)) throw invalid("integer expected");
        return (Long) value;
    }

    private static void requireKeys(Map<String, Object> object, String... keys) throws InvalidPayloadException {
        for (String key : keys) if (!object.containsKey(key)) throw invalid("required field");
    }

    private static void requireOnlyKeys(Map<String, Object> object, String... keys) throws InvalidPayloadException {
        Set<String> allowed = new HashSet<>(Arrays.asList(keys));
        for (String key : object.keySet()) if (!allowed.contains(key)) throw invalid("unknown field");
    }

    private static boolean isEncodeURIComponentUnescaped(char c) {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')
                || (c >= '0' && c <= '9') || "-_.!~*'()".indexOf(c) >= 0;
    }

    private static int hex(char c) {
        if (c >= '0' && c <= '9') return c - '0';
        if (c >= 'a' && c <= 'f') return c - 'a' + 10;
        if (c >= 'A' && c <= 'F') return c - 'A' + 10;
        return -1;
    }

    private static InvalidPayloadException invalid(String reason) {
        return new InvalidPayloadException(reason);
    }

    static final class InvalidPayloadException extends Exception {
        final String reason;
        InvalidPayloadException(String reason) { super(reason); this.reason = reason; }
    }

    static final class DigestPayload {
        final String rawJson;
        final String requestId;
        final String text;
        final Origin origin;
        final Note note;

        DigestPayload(String rawJson, String requestId, String text, Origin origin, Note note) {
            this.rawJson = rawJson;
            this.requestId = requestId;
            this.text = text;
            this.origin = origin;
            this.note = note;
        }
    }

    enum RequestMode { REVIEW, QUICK }

    static final class RequestEnvelope {
        final DigestPayload payload;
        final RequestMode mode;
        final String client, signature, setupHex;
        final long time;
        RequestEnvelope(DigestPayload payload, RequestMode mode, String client, long time, String signature, String setupHex) {
            this.payload = payload; this.mode = mode; this.client = client; this.time = time; this.signature = signature; this.setupHex = setupHex;
        }
        boolean isQuick() { return mode == RequestMode.QUICK; }
    }

    static final class ListDisplayName {
        final String value;
        final String problem;
        ListDisplayName(String value, String problem) { this.value = value; this.problem = problem; }
    }

    static final class Origin {
        final String vault, file, heading, before, after;
        Origin(String vault, String file, String heading, String before, String after) {
            this.vault = vault; this.file = file; this.heading = heading; this.before = before; this.after = after;
        }
    }

    static final class Note {
        final String path, fileId, pageId;
        final int page;
        final List<String> pageIds;
        Note(String path, int page, String fileId, String pageId, List<String> pageIds) {
            this.path = path; this.page = page; this.fileId = fileId; this.pageId = pageId; this.pageIds = pageIds;
        }
    }

    private static final class JsonParser {
        private final String input;
        private int index;

        JsonParser(String input) { this.input = input; }

        Object parse() throws InvalidPayloadException {
            Object value = value(0);
            whitespace();
            if (index != input.length()) throw invalid("trailing JSON");
            return value;
        }

        private Object value(int depth) throws InvalidPayloadException {
            if (depth > 16) throw invalid("JSON depth");
            whitespace();
            if (index >= input.length()) throw invalid("JSON value");
            char c = input.charAt(index);
            if (c == '{') return objectValue(depth + 1);
            if (c == '[') return arrayValue(depth + 1);
            if (c == '"') return stringValue();
            if (c == 't') return literal("true", Boolean.TRUE);
            if (c == 'f') return literal("false", Boolean.FALSE);
            if (c == 'n') return literal("null", null);
            if (c == '-' || (c >= '0' && c <= '9')) return numberValue();
            throw invalid("JSON token");
        }

        private Map<String, Object> objectValue(int depth) throws InvalidPayloadException {
            index++;
            whitespace();
            Map<String, Object> result = new LinkedHashMap<>();
            if (consume('}')) return result;
            while (true) {
                whitespace();
                if (index >= input.length() || input.charAt(index) != '"') throw invalid("JSON object key");
                String key = stringValue();
                if (result.containsKey(key)) throw invalid("duplicate JSON key");
                whitespace();
                require(':');
                result.put(key, value(depth));
                whitespace();
                if (consume('}')) return result;
                require(',');
            }
        }

        private List<Object> arrayValue(int depth) throws InvalidPayloadException {
            index++;
            whitespace();
            List<Object> result = new ArrayList<>();
            if (consume(']')) return result;
            while (true) {
                result.add(value(depth));
                if (result.size() > 1000) throw invalid("JSON array size");
                whitespace();
                if (consume(']')) return result;
                require(',');
            }
        }

        private String stringValue() throws InvalidPayloadException {
            require('"');
            StringBuilder out = new StringBuilder();
            while (index < input.length()) {
                char c = input.charAt(index++);
                if (c == '"') {
                    validateUnicode(out.toString());
                    return out.toString();
                }
                if (c < 0x20) throw invalid("JSON string control");
                if (c != '\\') {
                    out.append(c);
                    continue;
                }
                if (index >= input.length()) throw invalid("JSON escape");
                char escape = input.charAt(index++);
                switch (escape) {
                    case '"': out.append('"'); break;
                    case '\\': out.append('\\'); break;
                    case '/': out.append('/'); break;
                    case 'b': out.append('\b'); break;
                    case 'f': out.append('\f'); break;
                    case 'n': out.append('\n'); break;
                    case 'r': out.append('\r'); break;
                    case 't': out.append('\t'); break;
                    case 'u':
                        if (index + 4 > input.length()) throw invalid("JSON unicode escape");
                        int code = 0;
                        for (int n = 0; n < 4; n++) {
                            int h = hex(input.charAt(index++));
                            if (h < 0) throw invalid("JSON unicode escape");
                            code = (code << 4) | h;
                        }
                        out.append((char) code);
                        break;
                    default: throw invalid("JSON escape");
                }
            }
            throw invalid("unterminated JSON string");
        }

        private Object numberValue() throws InvalidPayloadException {
            int start = index;
            consume('-');
            if (consume('0')) {
                if (index < input.length() && isDigit(input.charAt(index))) throw invalid("JSON number");
            } else {
                if (index >= input.length() || input.charAt(index) < '1' || input.charAt(index) > '9') throw invalid("JSON number");
                while (index < input.length() && isDigit(input.charAt(index))) index++;
            }
            boolean decimal = false;
            if (consume('.')) {
                decimal = true;
                int digits = index;
                while (index < input.length() && isDigit(input.charAt(index))) index++;
                if (digits == index) throw invalid("JSON number");
            }
            if (index < input.length() && (input.charAt(index) == 'e' || input.charAt(index) == 'E')) {
                decimal = true;
                index++;
                if (index < input.length() && (input.charAt(index) == '+' || input.charAt(index) == '-')) index++;
                int digits = index;
                while (index < input.length() && isDigit(input.charAt(index))) index++;
                if (digits == index) throw invalid("JSON number");
            }
            String number = input.substring(start, index);
            try {
                return decimal ? new BigDecimal(number) : Long.valueOf(number);
            } catch (NumberFormatException ignored) {
                throw invalid("JSON number range");
            }
        }

        private Object literal(String expected, Object value) throws InvalidPayloadException {
            if (!input.regionMatches(index, expected, 0, expected.length())) throw invalid("JSON literal");
            index += expected.length();
            return value;
        }

        private void whitespace() {
            while (index < input.length()) {
                char c = input.charAt(index);
                if (c == ' ' || c == '\t' || c == '\r' || c == '\n') index++;
                else break;
            }
        }

        private boolean consume(char c) {
            if (index < input.length() && input.charAt(index) == c) { index++; return true; }
            return false;
        }

        private void require(char c) throws InvalidPayloadException {
            if (!consume(c)) throw invalid("JSON punctuation");
        }

        private static boolean isDigit(char c) { return c >= '0' && c <= '9'; }

        private static void validateUnicode(String value) throws InvalidPayloadException {
            for (int i = 0; i < value.length(); i++) {
                char c = value.charAt(i);
                if (Character.isHighSurrogate(c)) {
                    if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(i + 1))) throw invalid("unpaired surrogate");
                    i++;
                } else if (Character.isLowSurrogate(c)) {
                    throw invalid("unpaired surrogate");
                }
            }
        }
    }
}

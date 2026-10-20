package tools.supernote.logincallback;

/** Immutable input for a future, separately guarded native NOTE marker write. */
final class DigestAnchorRequest {
    static final String MARKER_TEXT = "+";

    final String notePath;
    final int page;
    final String fileId;
    final String pageId;
    final String digestId;
    final long digestTimeMillis;
    final String markerText;

    private DigestAnchorRequest(DigestProtocol.Note note, String digestId, long digestTimeMillis, String markerText) {
        this.notePath = note.path;
        this.page = note.page;
        this.fileId = note.fileId;
        this.pageId = note.pageId;
        this.digestId = digestId;
        this.digestTimeMillis = digestTimeMillis;
        this.markerText = markerText;
    }

    static DigestAnchorRequest forMarginMarker(DigestProtocol.Note note, String digestId,
            long digestTimeMillis, String markerText) {
        if (note == null) throw new IllegalArgumentException("note target required");
        if (note.path == null || note.page <= 0 || empty(note.fileId) || empty(note.pageId))
            throw new IllegalArgumentException("validated note identity required");
        if (digestId == null || !digestId.matches("[0-9a-fA-F]{32}"))
            throw new IllegalArgumentException("provider Digest UID required");
        if (digestTimeMillis <= 0) throw new IllegalArgumentException("positive Digest timestamp required");
        if (!MARKER_TEXT.equals(markerText)) throw new IllegalArgumentException("marker must be the native short '+' textbox");
        return new DigestAnchorRequest(note, digestId, digestTimeMillis, markerText);
    }

    private static boolean empty(String value) { return value == null || value.isEmpty(); }
}

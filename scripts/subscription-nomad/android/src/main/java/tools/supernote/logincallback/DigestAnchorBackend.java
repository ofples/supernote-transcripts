package tools.supernote.logincallback;

/**
 * Boundary for a future native NOTE anchor implementation. Implementations must
 * validate the closed target and its identity before writing; an ambiguous write
 * must be reported as uncertain and must not be retried blindly.
 */
interface DigestAnchorBackend {
    void writeMarginMarker(DigestAnchorRequest request) throws Exception;
}

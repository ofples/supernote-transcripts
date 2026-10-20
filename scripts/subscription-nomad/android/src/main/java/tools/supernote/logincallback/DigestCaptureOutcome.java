package tools.supernote.logincallback;

/** Reader callback outcome derived from the durable one-shot ledger. */
final class DigestCaptureOutcome {
    final String status;
    final long savedId;

    private DigestCaptureOutcome(String status, long savedId) {
        this.status = status;
        this.savedId = savedId;
    }

    static DigestCaptureOutcome fromLedger(String ledgerStatus, long ledgerSavedId, boolean knownNoWrite) {
        if ("SAVED".equals(ledgerStatus) && ledgerSavedId > 0) return new DigestCaptureOutcome("saved", ledgerSavedId);
        if ("PENDING".equals(ledgerStatus) || "UNCERTAIN".equals(ledgerStatus)) return new DigestCaptureOutcome("uncertain", -1L);
        if ("CANCELLED".equals(ledgerStatus) || (ledgerStatus == null && knownNoWrite)) return new DigestCaptureOutcome("cancelled", -1L);
        return new DigestCaptureOutcome("uncertain", -1L);
    }
}

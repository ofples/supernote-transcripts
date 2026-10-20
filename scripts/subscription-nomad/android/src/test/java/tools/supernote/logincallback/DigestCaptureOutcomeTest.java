package tools.supernote.logincallback;

import org.junit.Test;

import static org.junit.Assert.assertEquals;

public final class DigestCaptureOutcomeTest {
    @Test public void savedReceiptReturnsIdAndNeverDowngradesToFailure() {
        DigestCaptureOutcome outcome = DigestCaptureOutcome.fromLedger("SAVED", 27L, false);
        assertEquals("saved", outcome.status);
        assertEquals(27L, outcome.savedId);
    }

    @Test public void pendingOrUncertainWriteIsNeverReportedAsCancelled() {
        assertEquals("uncertain", DigestCaptureOutcome.fromLedger("PENDING", -1L, false).status);
        assertEquals("uncertain", DigestCaptureOutcome.fromLedger("UNCERTAIN", -1L, false).status);
    }

    @Test public void cancelledAndKnownNoWriteCanBeRetried() {
        assertEquals("cancelled", DigestCaptureOutcome.fromLedger("CANCELLED", -1L, false).status);
        assertEquals("cancelled", DigestCaptureOutcome.fromLedger(null, -1L, true).status);
    }

    @Test public void malformedOrUnknownLedgerStateFailsClosedAsUncertain() {
        assertEquals("uncertain", DigestCaptureOutcome.fromLedger("SAVED", -1L, false).status);
        assertEquals("uncertain", DigestCaptureOutcome.fromLedger("unexpected", -1L, false).status);
        assertEquals("uncertain", DigestCaptureOutcome.fromLedger(null, -1L, false).status);
    }
}

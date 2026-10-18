package tools.supernote.logincallback;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import java.io.File;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** User-reviewed Obsidian digest handoff. Provider writes are fixed-route and one-shot. */
public final class DigestActivity extends Activity {
    private static final String AUTHORITY = "com.ratta.supernote.knowledge.provider";
    private static final String KNOWLEDGE_PACKAGE = "com.ratta.supernote.knowledge";
    private static final String PROVIDER_CLASS = "com.ratta.supernote.knowledge.provider.KnowledgeContentProvider";
    private static final String READ_PERMISSION = "com.ratta.supernote.knowledge.permission.READ_KNOWLEDGE";
    private static final String WRITE_PERMISSION = "com.ratta.supernote.knowledge.permission.WRITE_KNOWLEDGE";
    private static final Uri INSERT_URI = Uri.parse("content://" + AUTHORITY + "/knowledge/insert");
    private static final int SOURCE_TYPE_SELF_ADD = 4;
    private static final int STATE_ADD = 2;
    private static final int SYNC_NOT_SYNCED = 0;
    private static final Object WRITE_LOCK = new Object();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private DigestRequestStore store;
    private DigestProtocol.DigestPayload payload;
    private String payloadSha;
    private TextView status;
    private TextView details;
    private Button saveButton, cancelButton, returnButton, openNotebookButton;
    private Button detailsButton;
    private boolean busy, cancelled, hasSaved, uncertain, blocked;
    private long savedId = -1;
    private String requestBlockMessage;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new DigestRequestStore(getApplicationContext());
        try {
            Intent intent = getIntent();
            if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())
                    || intent.getSelector() != null || intent.getClipData() != null
                    || (intent.getExtras() != null && !intent.getExtras().isEmpty())) {
                throw new DigestProtocol.InvalidPayloadException("intent");
            }
            payload = DigestProtocol.parseDeepLink(intent.getDataString());
            payloadSha = sha256(payload.rawJson);
            if (payload.note != null) {
                String canonical = new File(payload.note.path).getCanonicalPath();
                DigestProtocol.validateCanonicalNotePath(canonical);
                if (!canonical.equals(payload.note.path)) throw new DigestProtocol.InvalidPayloadException("noncanonical note path");
            }
            DigestProtocol.manualComment(payload);
            DigestProtocol.metadataJson(payload);
        } catch (DigestProtocol.InvalidPayloadException invalid) {
            if ("provider metadata limit".equals(invalid.reason)) requestBlockMessage = "This request's provenance metadata exceeds the 16 KB provider limit. No provider operation was made.";
            payload = null;
        } catch (Exception ignored) {
            payload = null;
        }
        buildScreen();
        if (payload == null) setStatus(requestBlockMessage == null ? "This Digest link is invalid or exceeds the supported limits. No provider operation was made." : requestBlockMessage);
        else {
            busy = true;
            setStatus("Checking whether this Digest request was handled before…");
            worker.execute(() -> {
                String prior;
                try { prior = refreshPriorState(); }
                catch (Exception error) { prior = "Previous status could not be checked (" + error.getClass().getSimpleName() + "). No write has been made in this session."; blocked = true; }
                final String message = prior;
                runOnUiThread(() -> {
                    if (isFinishing() || isDestroyed()) return;
                    busy = false;
                    setStatus(message == null ? "Review the selected text and source, then save when ready." : message);
                    updateButtons();
                });
            });
        }
        updateButtons();
    }

    private void buildScreen() {
        int pad = dp(18);
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL); content.setPadding(pad,pad,pad,pad);
        TextView title = new TextView(this); title.setText("Save to Digest"); title.setTextSize(26); content.addView(title);
        status = new TextView(this); status.setTextSize(15); status.setPadding(0,dp(10),0,dp(10)); content.addView(status);
        TextView source = new TextView(this); source.setTextSize(19); source.setPadding(0,dp(6),0,dp(8));
        source.setText(payload == null ? "Invalid request" : conciseSource()); content.addView(source);
        if (payload != null && payload.note != null) {
            TextView fallback = new TextView(this); fallback.setTextSize(16); fallback.setPadding(0,dp(4),0,dp(8));
            fallback.setText("The notebook and page will be kept as a reference. Native Digest page-jump is unavailable; you can open the original notebook after saving.");
            content.addView(fallback);
        }
        detailsButton = new Button(this); detailsButton.setText("Show Details"); detailsButton.setOnClickListener(v -> toggleDetails());
        content.addView(detailsButton, buttonParams());
        detailsButton.setVisibility(payload == null ? View.GONE : View.VISIBLE);
        details = new TextView(this); details.setTextSize(15); details.setPadding(0,dp(6),0,dp(10));
        details.setVisibility(View.GONE); details.setText(payload == null ? "" : formatDetails());
        content.addView(details, new LinearLayout.LayoutParams(-1,-2));
        TextView quoteLabel = new TextView(this); quoteLabel.setTextSize(16); quoteLabel.setText("Selected text"); content.addView(quoteLabel);
        TextView text = new TextView(this); text.setTextSize(19); text.setTextIsSelectable(true); text.setPadding(0,dp(10),0,dp(16));
        text.setText(payload == null ? "" : payload.text); content.addView(text, new LinearLayout.LayoutParams(-1,-2));
        saveButton = new Button(this); saveButton.setText("Save Digest"); saveButton.setOnClickListener(v -> save()); content.addView(saveButton, buttonParams());
        cancelButton = new Button(this); cancelButton.setText("Cancel"); cancelButton.setOnClickListener(v -> cancel()); content.addView(cancelButton, buttonParams());
        returnButton = new Button(this); returnButton.setText("Return to Obsidian"); returnButton.setOnClickListener(v -> returnToObsidian()); content.addView(returnButton, buttonParams());
        openNotebookButton = new Button(this); openNotebookButton.setText("Open original notebook");
        openNotebookButton.setOnClickListener(v -> openOriginalNotebook()); content.addView(openNotebookButton, buttonParams());
        openNotebookButton.setVisibility(View.GONE);
        ScrollView scroll = new ScrollView(this); scroll.addView(content); setContentView(scroll);
    }

    private String conciseSource() {
        if (payload.note != null) return fileName(payload.note.path) + " · page " + payload.note.page;
        return fileName(payload.origin.file);
    }

    private String fileName(String path) {
        int slash = path.lastIndexOf('/');
        return slash >= 0 ? path.substring(slash + 1) : path;
    }

    private String formatDetails() {
        StringBuilder b = new StringBuilder();
        b.append("Vault: ").append(payload.origin.vault).append("\nFile: ").append(payload.origin.file);
        if (payload.origin.heading != null) b.append("\nHeading: ").append(payload.origin.heading);
        if (payload.origin.before != null) b.append("\nBefore: ").append(payload.origin.before);
        if (payload.origin.after != null) b.append("\nAfter: ").append(payload.origin.after);
        if (payload.note != null) b.append("\nNotebook: ").append(payload.note.path).append("\nPage: ").append(payload.note.page)
                .append("\nFile ID: ").append(payload.note.fileId).append("\nPage ID: ").append(payload.note.pageId)
                .append("\nPage IDs: ").append(payload.note.pageIds);
        if (payload.note != null) b.append("\n\nNotebook source: reference only; native Digest page-jump is unavailable.");
        b.append("\n\nDestination: Supernote Digest");
        return b.toString();
    }

    private void toggleDetails() {
        boolean show = details.getVisibility() != View.VISIBLE;
        details.setVisibility(show ? View.VISIBLE : View.GONE);
        detailsButton.setText(show ? "Hide Details" : "Show Details");
    }

    private LinearLayout.LayoutParams buttonParams() {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1,-2); p.bottomMargin = dp(8); return p;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private String refreshPriorState() {
        synchronized (WRITE_LOCK) {
            DigestRequestStore.Entry entry = store.get(payload.requestId);
            if (entry == null) return null;
            if (!entry.sha.equals(payloadSha)) { blocked = true; return "This request ID was previously used with different content. It is blocked."; }
            if (DigestRequestStore.SAVED.equals(entry.status) && entry.savedId > 0) {
                if (verifySavedRow(entry.savedId)) { hasSaved = true; savedId = entry.savedId; return "Saved to Digest (entry " + savedId + ")."; }
                else { uncertain = true; return "A prior save is recorded, but its row could not be reverified. No retry is allowed."; }
            } else if (DigestRequestStore.PENDING.equals(entry.status)) {
                markUncertain(); return "A prior attempt has no completed acknowledgement. Its result is uncertain; no retry is allowed.";
            } else if (DigestRequestStore.UNCERTAIN.equals(entry.status)) { uncertain = true; return "A prior attempt has an uncertain result. No retry is allowed."; }
            else if (DigestRequestStore.CANCELLED.equals(entry.status)) return "This request was cancelled before writing. You can review it and try once.";
            return "This request has a saved local status that cannot be retried.";
        }
    }

    private void save() {
        if (payload == null || busy || hasSaved || uncertain || cancelled || blocked) return;
        busy = true; updateButtons(); setStatus("Preparing…");
        worker.execute(() -> {
            String result;
            try { result = performSave(); }
            catch (Exception error) {
                if (uncertain) result = "The save result is uncertain. Do not retry; choose Return to Obsidian to report the status.";
                else if (error instanceof SecurityException) result = "Supernote storage is unavailable or not authorized. No entry was sent.";
                else result = "Could not prepare this save (" + error.getClass().getSimpleName() + "). No entry was sent; you can try again.";
            }
            final String shown = result;
            runOnUiThread(() -> { if (isFinishing() || isDestroyed()) return; busy = false; setStatus(shown); updateButtons(); });
        });
    }

    private String performSave() throws Exception {
        synchronized (WRITE_LOCK) {
            requireProviderContract();
            DigestRequestStore.Entry prior = store.get(payload.requestId);
            if (prior != null) {
                if (!prior.sha.equals(payloadSha)) { blocked = true; return "This request ID belongs to different content. No write was made."; }
                if (DigestRequestStore.SAVED.equals(prior.status) && prior.savedId > 0 && verifySavedRow(prior.savedId)) {
                    hasSaved = true; savedId = prior.savedId; return "Saved to Digest (entry " + savedId + ").";
                }
                if (!DigestRequestStore.CANCELLED.equals(prior.status)) {
                    if (DigestRequestStore.PENDING.equals(prior.status)) markUncertain();
                    else uncertain = true;
                    return "A previous attempt may have reached the provider. No retry is allowed.";
                }
            } else if (store.count() >= DigestRequestStore.MAX_REQUESTS) {
                return "The local deduplication ledger is full. No write was made.";
            }
            ContentValues values = createValues();
            requireProviderContract();
            // The durable PENDING state is committed before the first provider operation.
            if (!store.put(payload.requestId, payloadSha, DigestRequestStore.PENDING, -1)) return "Could not persist the one-shot guard. Nothing was sent.";
            try {
                // From this point onward, even a thrown call may have reached the provider.
                uncertain = true;
                Uri ack = getContentResolver().insert(INSERT_URI, values);
                long id = DigestProtocol.parseProviderAcknowledgement(ack == null ? null : ack.toString());
                if (id <= 0 || !verifySavedRow(id)) {
                    markUncertain(); return "The provider result could not be verified for the returned ID. No retry is allowed.";
                }
                if (!store.put(payload.requestId, payloadSha, DigestRequestStore.SAVED, id)) {
                    markUncertain(); return "The entry was verified, but its local acknowledgement could not be persisted. Do not retry.";
                }
                uncertain = false; hasSaved = true; savedId = id;
                return "Saved to Digest (entry " + id + "). Choose Return to Obsidian to acknowledge.";
            } catch (Exception e) {
                markUncertain();
                throw e;
            }
        }
    }

    /** Keeps UI/callback state truthful even when persisting the secondary uncertainty marker fails. */
    private void markUncertain() {
        uncertain = true;
        try { store.put(payload.requestId, payloadSha, DigestRequestStore.UNCERTAIN, -1); }
        catch (RuntimeException ignored) { }
    }

    private ContentValues createValues() throws DigestProtocol.InvalidPayloadException {
        ContentValues v = new ContentValues();
        v.put("content", payload.text);
        long now = System.currentTimeMillis();
        v.put("source_type", SOURCE_TYPE_SELF_ADD);
        v.put("comment_str", DigestProtocol.manualComment(payload));
        v.put("metadata", DigestProtocol.metadataJson(payload));
        v.put("state", STATE_ADD); v.put("sync_state", SYNC_NOT_SYNCED);
        v.put("creation_time", now); v.put("last_modified_time", now);
        return v;
    }

    private boolean verifySavedRow(long id) {
        try {
            requireProviderContract();
            Uri item = Uri.parse("content://" + AUTHORITY + "/knowledge/" + id);
            try (Cursor c = getContentResolver().query(item, null, null, null, null)) {
            if (c == null || c.getCount() != 1 || !c.moveToFirst()) return false;
            int idCol = c.getColumnIndex("id"); if (idCol < 0 || c.getLong(idCol) != id) return false;
            int textCol = c.getColumnIndex("content"); if (textCol < 0 || !payload.text.equals(c.getString(textCol))) return false;
            int typeCol = c.getColumnIndex("source_type"); if (typeCol < 0) return false;
            int commentCol = c.getColumnIndex("comment_str"), metadataCol = c.getColumnIndex("metadata");
            return c.getInt(typeCol) == SOURCE_TYPE_SELF_ADD && commentCol >= 0
                    && DigestProtocol.manualComment(payload).equals(c.getString(commentCol))
                    && metadataCol >= 0 && DigestProtocol.metadataMatches(payload, c.getString(metadataCol));
            } catch (Exception ignored) { return false; }
        } catch (Exception ignored) { return false; }
    }

    private boolean providerContractReady() {
        ProviderInfo p;
        try { p = getPackageManager().resolveContentProvider(AUTHORITY, 0); }
        catch (RuntimeException ignored) { p = null; }
        return p != null && PROVIDER_CLASS.equals(p.name) && KNOWLEDGE_PACKAGE.equals(p.packageName)
                && READ_PERMISSION.equals(p.readPermission) && WRITE_PERMISSION.equals(p.writePermission)
                && checkSelfPermission(READ_PERMISSION) == PackageManager.PERMISSION_GRANTED
                && checkSelfPermission(WRITE_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }
    private void requireProviderContract() { if (!providerContractReady()) throw new SecurityException("Provider contract not ready"); }

    private void cancel() {
        if (busy || payload == null || hasSaved || uncertain) return;
        synchronized (WRITE_LOCK) {
            DigestRequestStore.Entry prior = store.get(payload.requestId);
            if (prior != null && !prior.sha.equals(payloadSha)) { setStatus("This request ID belongs to different content. Cancellation was not recorded."); return; }
            if (prior != null && !DigestRequestStore.CANCELLED.equals(prior.status)) { setStatus("A write attempt has started or completed; cancellation cannot change its result."); return; }
            if (prior == null && store.count() >= DigestRequestStore.MAX_REQUESTS) { setStatus("The local deduplication ledger is full. Cancellation was not recorded."); return; }
            if (prior == null && !store.put(payload.requestId, payloadSha, DigestRequestStore.CANCELLED, -1)) { setStatus("Cancellation could not be recorded."); return; }
            cancelled = true;
        }
        setStatus("Cancelled before any provider write. Returning to Obsidian…"); updateButtons();
        returnToObsidian();
    }

    private void returnToObsidian() {
        if (payload == null || busy) return;
        String result; String id = null;
        if (hasSaved) { result = "saved"; id = Long.toString(savedId); }
        else if (uncertain) result = "uncertain";
        else if (cancelled) result = "cancelled";
        else return;
        Uri.Builder b = new Uri.Builder().scheme("obsidian").authority("md-reader-digest-result")
                .appendQueryParameter("vault", payload.origin.vault)
                .appendQueryParameter("request", payload.requestId)
                .appendQueryParameter("status", result);
        if (id != null) b.appendQueryParameter("id", id);
        Intent intent = new Intent(Intent.ACTION_VIEW, b.build());
        try { startActivity(intent); finish(); }
        catch (RuntimeException e) { setStatus("No Obsidian acknowledgement handler opened (" + e.getClass().getSimpleName() + "). You can return manually."); }
    }

    private void openOriginalNotebook() {
        if (payload == null || payload.note == null || !hasSaved || busy) return;
        Uri target = new Uri.Builder().scheme("supernote-transcripts").authority("open-note")
                .appendQueryParameter("file", payload.note.path)
                .appendQueryParameter("page", Integer.toString(payload.note.page)).build();
        try { startActivity(new Intent(this, OpenNoteActivity.class).setAction(Intent.ACTION_VIEW).setData(target)); }
        catch (RuntimeException e) { setStatus("Could not open the notebook (" + e.getClass().getSimpleName() + ")."); }
    }

    private void updateButtons() {
        boolean outcome = hasSaved || uncertain || cancelled;
        boolean canReview = payload != null && !outcome && !blocked;
        saveButton.setVisibility(canReview ? View.VISIBLE : View.GONE);
        cancelButton.setVisibility(canReview ? View.VISIBLE : View.GONE);
        saveButton.setEnabled(canReview && !busy);
        cancelButton.setEnabled(canReview && !busy);
        returnButton.setVisibility(payload != null && outcome ? View.VISIBLE : View.GONE);
        returnButton.setEnabled(payload != null && !busy && outcome);
        if (openNotebookButton != null) {
            openNotebookButton.setVisibility(payload != null && payload.note != null && hasSaved ? View.VISIBLE : View.GONE);
            openNotebookButton.setEnabled(!busy && hasSaved);
        }
    }
    private void setStatus(String value) { status.setText(value); }

    private static String sha256(String input) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(input.getBytes("UTF-8"));
        StringBuilder out = new StringBuilder(64); for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 0xff)); return out.toString();
    }

    @Override protected void onDestroy() {
        worker.shutdown();
        if (store != null) {
            DigestRequestStore closingStore = store;
            Thread closer = new Thread(() -> {
                try {
                    while (!worker.isTerminated()) worker.awaitTermination(1, java.util.concurrent.TimeUnit.DAYS);
                }
                catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                closingStore.close();
            }, "DigestStoreCloser");
            closer.setDaemon(true); closer.start();
        }
        super.onDestroy();
    }
}

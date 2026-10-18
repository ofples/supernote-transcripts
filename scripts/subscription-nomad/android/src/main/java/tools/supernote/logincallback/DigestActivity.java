package tools.supernote.logincallback;

import android.app.Activity;
import android.content.ComponentName;
import android.content.ContentValues;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ProviderInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;

import java.io.File;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** User-reviewed Digest capture and explicitly enrolled Reader quick-save. */
public final class DigestActivity extends Activity {
    private static final String AUTHORITY = "com.ratta.supernote.knowledge.provider";
    private static final String KNOWLEDGE_PACKAGE = "com.ratta.supernote.knowledge";
    private static final String PROVIDER_CLASS = "com.ratta.supernote.knowledge.provider.KnowledgeContentProvider";
    private static final String KNOWLEDGE_DETAIL_ACTIVITY = "com.ratta.supernote.knowledge.activity.KnowledgeDetailWrapperActivity";
    private static final String READ_PERMISSION = "com.ratta.supernote.knowledge.permission.READ_KNOWLEDGE";
    private static final String WRITE_PERMISSION = "com.ratta.supernote.knowledge.permission.WRITE_KNOWLEDGE";
    private static final Uri INSERT_URI = Uri.parse("content://" + AUTHORITY + "/knowledge/insert");
    private static final Uri LIST_URI = Uri.parse("content://" + AUTHORITY + "/knowledge_base");
    private static final int SOURCE_TYPE_SELF_ADD = 4, STATE_ADD = 2, SYNC_NOT_SYNCED = 0;
    private static final Object WRITE_LOCK = new Object();
    private static final String PREFS = "digest_bridge_preferences";
    private static final String DEFAULT_ATTRIBUTE = "default_list_attribute";
    private static final String DEFAULT_UNCATEGORIZED = "default_uncategorized";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final List<ListChoice> choices = new ArrayList<>();
    private DigestRequestStore store;
    private QuickTrustStore trustStore;
    private SharedPreferences prefs;
    private DigestProtocol.RequestEnvelope envelope;
    private DigestReceiptRoute.Request receiptRequest;
    private DigestProtocol.DigestPayload payload;
    private String payloadSha, userNote = "", loadError, listWarning, receiptErrorMessage;
    private TextView status, details, noteCounter;
    private Spinner listSpinner;
    private EditText noteInput;
    private CheckBox defaultCheck;
    private Button saveButton, cancelButton, returnButton, openNotebookButton, detailsButton;
    private Button approveQuickButton, refreshButton, setDefaultButton, revokeAllButton;
    private Button doneButton;
    private LinearLayout trustedClientsContainer;
    private boolean settingsMode, receiptMode, busy, cancelled, hasSaved, uncertain, blocked, listsReady;
    private boolean quickAuthorized, quickSetupPending, autoQuickPending;
    private long savedId = -1;
    private String requestBlockMessage;
    private final List<Button> revokeButtons = new ArrayList<>();

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        store = new DigestRequestStore(getApplicationContext());
        trustStore = new QuickTrustStore(getApplicationContext());
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        try {
            Intent intent = getIntent();
            if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction()) || intent.getSelector() != null
                    || intent.getClipData() != null || (intent.getExtras() != null && !intent.getExtras().isEmpty())) {
                throw new DigestProtocol.InvalidPayloadException("intent");
            }
            if (isSettingsUri(intent.getData())) settingsMode = true;
            else if (isReceiptAuthority(intent.getData())) {
                receiptMode = true;
                try { receiptRequest = DigestReceiptRoute.parse(intent.getDataString()); }
                catch (DigestReceiptRoute.InvalidRouteException invalid) {
                    receiptErrorMessage = "This saved Digest link is invalid. Nothing was opened.";
                }
            }
            else {
                envelope = DigestProtocol.parseEnvelope(intent.getDataString());
                payload = envelope.payload;
                payloadSha = sha256(payload.rawJson);
                if (payload.note != null) {
                    String canonical = new File(payload.note.path).getCanonicalPath();
                    DigestProtocol.validateCanonicalNotePath(canonical);
                    if (!canonical.equals(payload.note.path)) throw new DigestProtocol.InvalidPayloadException("noncanonical note path");
                }
                DigestProtocol.manualComment(payload);
                DigestProtocol.metadataJson(payload);
            }
        } catch (DigestProtocol.InvalidPayloadException invalid) {
            if ("provider metadata limit".equals(invalid.reason)) requestBlockMessage = "This request's provenance exceeds the provider limit. No provider operation was made.";
            payload = null; envelope = null;
        } catch (Exception ignored) {
            if (receiptMode) receiptErrorMessage = "This saved Digest link is invalid. Nothing was opened.";
            payload = null; envelope = null;
        }

        if (settingsMode) buildSettingsScreen();
        else if (receiptMode) buildReceiptScreen();
        else buildDigestScreen();
        if (settingsMode || payload != null) loadListsAndPriorState();
        else if (receiptMode) {
            if (receiptRequest == null) setStatus(receiptErrorMessage == null ? "This saved Digest link is invalid. Nothing was opened." : receiptErrorMessage);
            else openSavedDigestReceipt();
        }
        else setStatus(requestBlockMessage == null ? "This Digest link is invalid or exceeds supported limits. No provider operation was made." : requestBlockMessage);
        updateButtons();
    }

    private boolean isSettingsUri(Uri uri) {
        return uri != null && "supernote-bridge".equals(uri.getScheme()) && "digest-settings".equals(uri.getAuthority())
                && (uri.getEncodedPath() == null || uri.getEncodedPath().isEmpty()) && uri.getQuery() == null && uri.getFragment() == null;
    }

    private boolean isReceiptAuthority(Uri uri) {
        return uri != null && "supernote-bridge".equals(uri.getScheme()) && "digest-receipt".equals(uri.getAuthority());
    }

    private void buildReceiptScreen() {
        LinearLayout content = screenContent("Open Digest");
        status = addText(content, "", 16, 12, 8);
        addText(content, "This opens the saved entry in the native Digest app. Use its Edit control to make changes.", 16, 4, 8);
        button(content, "Done", v -> finish());
        ScrollView scroll = new ScrollView(this); scroll.addView(content); setContentView(scroll);
    }

    private void openSavedDigestReceipt() {
        busy = true;
        setStatus("Checking saved Digest…");
        worker.execute(() -> {
            long authorizedId = -1L;
            String failure = null;
            try {
                synchronized (WRITE_LOCK) {
                    DigestRequestStore.Entry entry = store.get(receiptRequest.requestId);
                    if (entry == null || !DigestRequestStore.SAVED.equals(entry.status) || entry.savedId <= 0) {
                        failure = "This Digest was saved on another device, or its local receipt is unavailable. Nothing was opened.";
                    }
                    else {
                        authorizedId = DigestReceiptRoute.authorizedSavedId(entry.status, entry.savedId, receiptRequest.assertedId);
                        if (authorizedId <= 0) failure = "This Open Digest link does not match the saved entry. Nothing was opened.";
                    }
                    if (failure == null && !providerContractReady()) {
                        failure = "The Supernote Digest provider is unavailable or not authorized. Nothing was opened.";
                    }
                    if (failure == null && !nativeDetailActivityReady()) {
                        failure = "The native Digest detail screen is unavailable. Nothing was opened.";
                    }
                }
            } catch (Exception ignored) {
                failure = "The saved Digest receipt could not be checked. Nothing was opened.";
            }
            final long id = authorizedId;
            final String error = failure;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                busy = false;
                if (error != null) {
                    setStatus(error);
                    updateButtons();
                    return;
                }
                try {
                    Intent nativeDetail = new Intent();
                    nativeDetail.setComponent(new ComponentName(KNOWLEDGE_PACKAGE, KNOWLEDGE_DETAIL_ACTIVITY));
                    nativeDetail.putExtra("knowledge_id", id);
                    nativeDetail.putExtra("from_app", "knowledge");
                    startActivity(nativeDetail);
                    finish();
                } catch (RuntimeException ignored) {
                    setStatus("The native Digest detail screen could not be opened. No Digest was changed.");
                    updateButtons();
                }
            });
        });
    }

    private boolean nativeDetailActivityReady() {
        ComponentName component = new ComponentName(KNOWLEDGE_PACKAGE, KNOWLEDGE_DETAIL_ACTIVITY);
        try {
            ActivityInfo info = getPackageManager().getActivityInfo(component, 0);
            return KNOWLEDGE_PACKAGE.equals(info.packageName) && KNOWLEDGE_DETAIL_ACTIVITY.equals(info.name)
                    && info.enabled && info.exported && info.applicationInfo != null && info.applicationInfo.enabled;
        } catch (PackageManager.NameNotFoundException | RuntimeException ignored) {
            return false;
        }
    }

    private void loadListsAndPriorState() {
        busy = true; setStatus("Preparing…"); updateButtons();
        worker.execute(() -> {
            String message = null;
            try {
                synchronized (WRITE_LOCK) {
                    if (!providerContractReady()) throw new ListLoadFailure("PROVIDER_CONTRACT_NOT_READY");
                    List<ListChoice> loaded = queryLists();
                    choices.clear(); choices.addAll(loaded); listsReady = true; loadError = null;
                    if (!settingsMode) message = refreshPriorState();
                }
            } catch (Exception error) {
                listsReady = false; loadError = "Could not load Digest lists [" + listFailureSummary(error) + "]. Check Supernote permissions, then refresh.";
            }
            final String shown = message;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                busy = false;
                if (settingsMode) populateSettingsLists(); else populateReviewLists();
                if (loadError != null) setStatus(loadError);
                else if (shown != null) setStatus(shown);
                else if (listWarning != null) setStatus(listWarning);
                else if (envelope != null && envelope.isQuick() && quickSetupPending) setStatus("Review the quote and list, then allow Reader Quick Digest to save this entry.");
                else setStatus("Review the quote and source, choose a Digest list, then save when ready.");
                if (!settingsMode && autoQuickPending && shown == null && listsReady) {
                    ListChoice defaultChoice = defaultChoice();
                    if (defaultChoice != null) { autoQuickPending = false; saveWithChoice(defaultChoice, "", true); }
                    else { autoQuickPending = false; setStatus("Choose a Digest list. Quick Digest has no valid saved default, so this request was not saved automatically."); }
                }
                updateButtons();
            });
        });
    }

    private List<ListChoice> queryLists() throws Exception {
        List<ListChoice> result = new ArrayList<>();
        Map<String, Integer> skipped = new LinkedHashMap<>();
        listWarning = null;
        try (Cursor c = getContentResolver().query(LIST_URI, null, null, null, null)) {
            if (c == null) throw new ListLoadFailure("LIST_CURSOR_NULL");
            int count = c.getCount();
            if (count > 100) throw new ListLoadFailure("LIST_COUNT_LIMIT count=" + count + " limit=100 columns=" + safeColumns(c));
            int idCol = c.getColumnIndex("id"), nameCol = c.getColumnIndex("name"), attrCol = c.getColumnIndex("unique_attribute");
            if (idCol < 0 || nameCol < 0 || attrCol < 0) {
                List<String> missing = new ArrayList<>();
                if (idCol < 0) missing.add("id"); if (nameCol < 0) missing.add("name"); if (attrCol < 0) missing.add("unique_attribute");
                throw new ListLoadFailure("LIST_SCHEMA_MISSING missing=" + missing + " columns=" + safeColumns(c) + " count=" + count);
            }
            if (count == 0) throw new ListLoadFailure("LIST_EMPTY count=0 columns=" + safeColumns(c));
            int rowIndex = 0;
            while (c.moveToNext()) {
                String types = cursorType(c, idCol) + "/" + cursorType(c, nameCol) + "/" + cursorType(c, attrCol);
                int idType = c.getType(idCol), nameType = c.getType(nameCol), attrType = c.getType(attrCol);
                if (idType != Cursor.FIELD_TYPE_INTEGER) {
                    addListDiagnostic(skipped, "row_type/default=unknown/types=" + types); rowIndex++; continue;
                }
                long id = c.getLong(idCol);
                boolean isDefault = id == 0;
                if ((nameType != Cursor.FIELD_TYPE_STRING && nameType != Cursor.FIELD_TYPE_NULL)
                        || (attrType != Cursor.FIELD_TYPE_STRING && attrType != Cursor.FIELD_TYPE_NULL)) {
                    addListDiagnostic(skipped, "row_type/default=" + isDefault + "/types=" + types); rowIndex++; continue;
                }
                String name = c.isNull(nameCol) ? null : c.getString(nameCol);
                String attribute = c.isNull(attrCol) ? null : c.getString(attrCol);
                if (id < 0) { addListDiagnostic(skipped, "id_invalid/default=false"); rowIndex++; continue; }
                if (id == 0 && attribute != null && attribute.isEmpty()) attribute = null;
                if (!DigestProtocol.isValidListChoiceIdentity(id, attribute) || (attribute != null && hasControls(attribute))) {
                    String code = id == 0 ? "association_invalid/default=true" : (attribute == null || attribute.isEmpty()
                            ? "association_missing/default=false" : "association_invalid/default=false");
                    addListDiagnostic(skipped, code); rowIndex++; continue;
                }
                DigestProtocol.ListDisplayName displayName = DigestProtocol.normalizeListDisplayName(name, isDefault);
                if (displayName.value == null) {
                    addListDiagnostic(skipped, displayName.problem + "/default=" + isDefault); rowIndex++; continue;
                }
                for (ListChoice prior : result) {
                    if ((attribute != null && attribute.equals(prior.attribute)) || (id == prior.id)) {
                        addListDiagnostic(skipped, "duplicate/default=" + isDefault); displayName = null; break;
                    }
                }
                if (displayName != null) result.add(new ListChoice(id, displayName.value, attribute));
                rowIndex++;
            }
            if (!skipped.isEmpty()) listWarning = formatListWarning(skipped);
            if (result.isEmpty()) throw new ListLoadFailure("LISTS_NO_VALID_ROWS count=" + count + " skipped=" + summarizeListDiagnostics(skipped)
                    + " columns=" + safeColumns(c));
        }
        return result;
    }

    private void addListDiagnostic(Map<String, Integer> diagnostics, String code) {
        Integer count = diagnostics.get(code);
        diagnostics.put(code, count == null ? 1 : count + 1);
    }

    private String summarizeListDiagnostics(Map<String, Integer> diagnostics) {
        StringBuilder out = new StringBuilder("{");
        boolean first = true;
        for (Map.Entry<String, Integer> entry : diagnostics.entrySet()) {
            if (!first) out.append(',');
            first = false;
            out.append(entry.getKey()).append(':').append(entry.getValue());
        }
        return out.append('}').toString();
    }

    private String formatListWarning(Map<String, Integer> skipped) {
        int count = 0;
        for (Integer value : skipped.values()) count += value;
        return "Some lists unavailable (" + count + " rows skipped).";
    }

    private String listFailureSummary(Exception error) {
        if (error instanceof ListLoadFailure) return ((ListLoadFailure) error).diagnostic;
        String type = error == null ? "Unknown" : error.getClass().getSimpleName();
        if (type.isEmpty() || !type.matches("[A-Za-z0-9_]{1,48}")) type = "Unknown";
        return "LIST_QUERY_FAILED type=" + type;
    }

    private String safeColumns(Cursor cursor) {
        StringBuilder out = new StringBuilder("[");
        String[] names = cursor.getColumnNames();
        int limit = Math.min(names == null ? 0 : names.length, 24);
        for (int i = 0; i < limit; i++) {
            if (i > 0) out.append(',');
            String name = names[i];
            if (name == null || !name.matches("[A-Za-z0-9_]{1,64}")) out.append("?"); else out.append(name);
        }
        if (names != null && names.length > limit) out.append(",…");
        return out.append(']').toString();
    }

    private String cursorType(Cursor cursor, int column) {
        switch (cursor.getType(column)) {
            case Cursor.FIELD_TYPE_NULL: return "NULL";
            case Cursor.FIELD_TYPE_INTEGER: return "INTEGER";
            case Cursor.FIELD_TYPE_FLOAT: return "FLOAT";
            case Cursor.FIELD_TYPE_STRING: return "TEXT";
            case Cursor.FIELD_TYPE_BLOB: return "BLOB";
            default: return "UNKNOWN";
        }
    }

    private static final class ListLoadFailure extends IllegalStateException {
        final String diagnostic;
        ListLoadFailure(String diagnostic) { super("List query validation failed"); this.diagnostic = diagnostic; }
    }

    private boolean hasControls(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (Character.isISOControl(c)) return true;
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= value.length() || !Character.isLowSurrogate(value.charAt(i + 1))) return true;
                i++;
            } else if (Character.isLowSurrogate(c)) return true;
        }
        return false;
    }

    private String refreshPriorState() {
        if (envelope != null && envelope.isQuick()) {
            QuickTrustStore.Entry trusted = trustStore.get(envelope.client);
            byte[] signingSecret = trusted == null ? null : trusted.secret;
            boolean known = trusted != null && payload.origin.vault.equals(trusted.vault);
            boolean setupAllowed = trusted == null && envelope.setupHex != null;
            if (setupAllowed) {
                try { signingSecret = DigestProtocol.parseHexSecret(envelope.setupHex); }
                catch (Exception ignored) { signingSecret = null; }
            } else if (known && envelope.setupHex != null) {
                try { known = MessageDigest.isEqual(signingSecret, DigestProtocol.parseHexSecret(envelope.setupHex)); }
                catch (Exception ignored) { known = false; }
            }
            boolean fresh = DigestProtocol.isTimestampFresh(System.currentTimeMillis(), envelope.time);
            boolean signature = fresh && signingSecret != null && DigestProtocol.quickSignatureMatches(envelope.client, envelope.time, payload.rawJson, signingSecret, envelope.signature);
            quickSetupPending = setupAllowed && signature;
            quickAuthorized = known && signature;
            if (!signature) loadError = "Reader Quick Digest could not be authenticated. You can review and save this item manually.";
        }
        DigestRequestStore.Entry entry = store.get(payload.requestId);
        if (entry == null) {
            if (quickAuthorized) {
                ListChoice d = defaultChoice();
                if (d != null) { autoQuickPending = true; return null; }
            }
            return null;
        }
        if (!entry.sha.equals(payloadSha)) { blocked = true; return "This request ID was previously used with different content. It is blocked."; }
        if (DigestRequestStore.SAVED.equals(entry.status) && entry.savedId > 0) {
            String expectedComment = entry.savedComment == null ? manualCommentOrNull("") : entry.savedComment;
            if (expectedComment != null && verifySavedRow(entry.savedId, expectedComment, entry.listAttribute, entry.savedComment != null)) {
                hasSaved = true; savedId = entry.savedId; return "Saved to Digest (entry " + savedId + ").";
            }
            uncertain = true; return "A prior save is recorded, but its row could not be reverified. No retry is allowed.";
        } else if (DigestRequestStore.PENDING.equals(entry.status)) {
            markUncertain(entry); return "A prior attempt has no completed acknowledgement. Its result is uncertain; no retry is allowed.";
        } else if (DigestRequestStore.UNCERTAIN.equals(entry.status)) {
            uncertain = true; return "A prior attempt has an uncertain result. No retry is allowed.";
        } else if (DigestRequestStore.CANCELLED.equals(entry.status)) {
            quickAuthorized = false; quickSetupPending = false;
            return "This request was cancelled before writing. You can review it and try once.";
        }
        return "This request has a saved local status that cannot be retried.";
    }

    private String manualCommentOrNull(String note) {
        try { return DigestProtocol.manualComment(payload, note); } catch (Exception ignored) { return null; }
    }

    private void buildDigestScreen() {
        LinearLayout content = screenContent("Save to Digest");
        status = addText(content, "", 15, 10, 8);
        TextView source = addText(content, payload == null ? "Invalid request" : conciseSource(), 19, 6, 8);
        if (payload != null && payload.note != null) addText(content,
                "Notebook and page are kept as a reference. Native Digest page-jump is unavailable; you can open the original notebook after saving.", 15, 2, 8);
        detailsButton = button(content, "Show Details", v -> toggleDetails());
        detailsButton.setVisibility(payload == null ? View.GONE : View.VISIBLE);
        details = addText(content, payload == null ? "" : formatDetails(), 14, 4, 8); details.setVisibility(View.GONE);
        addText(content, "Selected text", 16, 4, 0);
        TextView quote = addText(content, payload == null ? "" : payload.text, 18, 8, 14); quote.setTextIsSelectable(true);
        addText(content, "List", 16, 4, 0);
        listSpinner = new Spinner(this); content.addView(listSpinner, new LinearLayout.LayoutParams(-1, -2));
        defaultCheck = new CheckBox(this); defaultCheck.setText("Use as default for Quick Digest"); content.addView(defaultCheck);
        addText(content, "Note (optional)", 16, 8, 0);
        noteInput = new EditText(this); noteInput.setSingleLine(false); noteInput.setMinLines(2); noteInput.setMaxLines(5); noteInput.setGravity(android.view.Gravity.TOP);
        noteInput.setHint("Add a note to this Digest"); content.addView(noteInput, new LinearLayout.LayoutParams(-1, -2));
        noteCounter = addText(content, "0 / 2000", 13, 0, 8);
        noteInput.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) { }
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) { userNote = s.toString(); updateNoteCounter(); updateButtons(); }
            @Override public void afterTextChanged(Editable s) { }
        });
        refreshButton = button(content, "Refresh lists", v -> loadListsAndPriorState());
        approveQuickButton = button(content, "Enable Quick Digest and save", v -> approveQuickAndSave());
        saveButton = button(content, "Save Digest", v -> onSavePressed());
        cancelButton = button(content, "Cancel", v -> cancel());
        returnButton = button(content, "Return to Obsidian", v -> returnToObsidian());
        openNotebookButton = button(content, "Open original notebook", v -> openOriginalNotebook());
        ScrollView scroll = new ScrollView(this); scroll.addView(content); setContentView(scroll);
    }

    private void buildSettingsScreen() {
        LinearLayout content = screenContent("Digest settings");
        status = addText(content, "Choose the default list used by Reader Quick Digest.", 15, 10, 8);
        addText(content, "Default Quick Digest list", 16, 6, 0);
        listSpinner = new Spinner(this); content.addView(listSpinner, new LinearLayout.LayoutParams(-1, -2));
        setDefaultButton = button(content, "Use selected list as default", v -> saveSelectedDefault());
        refreshButton = button(content, "Refresh lists", v -> loadListsAndPriorState());
        addText(content, "Trusted Reader clients", 16, 18, 4);
        trustedClientsContainer = new LinearLayout(this); trustedClientsContainer.setOrientation(LinearLayout.VERTICAL); content.addView(trustedClientsContainer);
        populateTrustedClients(trustedClientsContainer);
        revokeAllButton = button(content, "Revoke all Quick Digest clients", v -> revokeAllQuickClients());
        doneButton = button(content, "Done", v -> finish());
        ScrollView scroll = new ScrollView(this); scroll.addView(content); setContentView(scroll);
    }

    private LinearLayout screenContent(String titleText) {
        LinearLayout content = new LinearLayout(this); content.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(18); content.setPadding(pad, pad, pad, pad);
        TextView title = new TextView(this); title.setText(titleText); title.setTextSize(26); content.addView(title);
        return content;
    }
    private TextView addText(LinearLayout parent, String value, int size, int top, int bottom) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setPadding(0, dp(top), 0, dp(bottom)); parent.addView(view, new LinearLayout.LayoutParams(-1, -2)); return view;
    }
    private Button button(LinearLayout parent, String label, View.OnClickListener click) {
        Button b = new Button(this); b.setText(label); b.setOnClickListener(click); LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2); p.bottomMargin = dp(8); parent.addView(b, p); return b;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private void populateReviewLists() {
        if (listSpinner == null) return;
        ArrayAdapter<ListChoice> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, choices);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); listSpinner.setAdapter(adapter);
        ListChoice target = defaultChoice(); if (target == null && !choices.isEmpty()) target = choices.get(0);
        if (target != null) listSpinner.setSelection(choices.indexOf(target));
        if (defaultCheck != null) defaultCheck.setChecked(target != null && sameChoice(target, defaultChoice()));
        if (defaultCheck != null && quickSetupPending) {
            defaultCheck.setText("This list becomes the Quick Digest default");
            defaultCheck.setChecked(true);
            defaultCheck.setEnabled(false);
        } else if (defaultCheck != null) {
            defaultCheck.setText("Use as default for Quick Digest");
            defaultCheck.setEnabled(true);
        }
        updateNoteCounter();
    }
    private void populateSettingsLists() {
        if (listSpinner == null) return;
        ArrayAdapter<ListChoice> adapter = new ArrayAdapter<>(this, android.R.layout.simple_spinner_item, choices);
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item); listSpinner.setAdapter(adapter);
        ListChoice target = defaultChoice(); if (target != null) listSpinner.setSelection(choices.indexOf(target));
        updateButtons();
    }
    private ListChoice selectedChoice() {
        if (!listsReady || listSpinner == null || listSpinner.getSelectedItemPosition() < 0 || listSpinner.getSelectedItemPosition() >= choices.size()) return null;
        return choices.get(listSpinner.getSelectedItemPosition());
    }
    private ListChoice defaultChoice() {
        if (prefs.getBoolean(DEFAULT_UNCATEGORIZED, false)) {
            for (ListChoice c : choices) if (c.id == 0 && c.attribute == null) return c;
            return null;
        }
        String attr = prefs.getString(DEFAULT_ATTRIBUTE, null);
        if (attr == null) return findDefaultRow();
        for (ListChoice c : choices) if (attr.equals(c.attribute)) return c;
        return null;
    }
    private ListChoice findDefaultRow() {
        for (ListChoice c : choices) if (c.id == 0) return c;
        return null;
    }
    private boolean sameChoice(ListChoice a, ListChoice b) { return a != null && b != null && (a.attribute == null ? b.attribute == null && a.id == b.id : a.attribute.equals(b.attribute)); }
    private void persistDefault(ListChoice choice) {
        SharedPreferences.Editor editor = prefs.edit().putBoolean(DEFAULT_UNCATEGORIZED, choice.attribute == null);
        if (choice.attribute == null) editor.remove(DEFAULT_ATTRIBUTE); else editor.putString(DEFAULT_ATTRIBUTE, choice.attribute);
        if (!editor.commit()) throw new IllegalStateException("Could not save default list");
    }

    private String conciseSource() { return payload.note != null ? fileName(payload.note.path) + " · page " + payload.note.page : fileName(payload.origin.file); }
    private String fileName(String path) { int slash = path.lastIndexOf('/'); return slash >= 0 ? path.substring(slash + 1) : path; }
    private String formatDetails() {
        StringBuilder b = new StringBuilder("Vault: ").append(payload.origin.vault).append("\nFile: ").append(payload.origin.file);
        if (payload.origin.heading != null) b.append("\nHeading: ").append(payload.origin.heading);
        if (payload.origin.before != null) b.append("\nBefore: ").append(payload.origin.before);
        if (payload.origin.after != null) b.append("\nAfter: ").append(payload.origin.after);
        if (payload.note != null) b.append("\nNotebook: ").append(payload.note.path).append("\nPage: ").append(payload.note.page)
                .append("\nFile ID: ").append(payload.note.fileId).append("\nPage ID: ").append(payload.note.pageId).append("\nPage IDs: ").append(payload.note.pageIds);
        return b.toString();
    }
    private void toggleDetails() { boolean show = details.getVisibility() != View.VISIBLE; details.setVisibility(show ? View.VISIBLE : View.GONE); detailsButton.setText(show ? "Hide Details" : "Show Details"); }
    private void updateNoteCounter() {
        if (noteCounter == null || payload == null) return;
        String note = noteInput == null ? userNote : noteInput.getText().toString();
        int used = manualCommentLength(note);
        noteCounter.setText(used + " / 2000 · " + Math.max(0, 2000 - used) + " characters remaining");
    }
    private int manualCommentLength(String note) { try { return DigestProtocol.manualComment(payload, note).length(); } catch (Exception e) { return 2001; } }

    private void onSavePressed() {
        ListChoice selected = selectedChoice();
        if (selected == null) { setStatus("Refresh and choose an available Digest list before saving."); return; }
        if (manualCommentLength(noteInput.getText().toString()) > 2000) { setStatus("The note and source details exceed the Digest comment limit. Shorten the note."); return; }
        if (defaultCheck.isChecked() && !quickSetupPending) {
            try { persistDefault(selected); } catch (Exception e) { setStatus("Could not save the default list (" + e.getClass().getSimpleName() + "). No Digest was sent."); return; }
        }
        saveWithChoice(selected, noteInput.getText().toString(), false);
    }

    private void approveQuickAndSave() {
        if (!quickSetupPending || envelope == null || envelope.setupHex == null) return;
        ListChoice selected = selectedChoice();
        if (selected == null) { setStatus("Refresh and choose a Digest list before allowing Quick Digest."); return; }
        String note = noteInput.getText().toString();
        if (manualCommentLength(note) > 2000) { setStatus("The note and source details exceed the Digest comment limit. Shorten the note."); return; }
        byte[] secret;
        try { secret = DigestProtocol.parseHexSecret(envelope.setupHex); }
        catch (Exception e) { setStatus("Reader setup could not be verified. Review and save manually instead."); return; }
        try { persistDefault(selected); }
        catch (Exception e) { setStatus("Could not save this Quick Digest default (" + e.getClass().getSimpleName() + "). No client was enrolled and no Digest was sent."); return; }
        if (!trustStore.put(envelope.client, payload.origin.vault, secret)) { setStatus("Quick Digest could not be enabled on this device. You can still save this item with review."); return; }
        quickAuthorized = true; quickSetupPending = false;
        saveWithChoice(selected, note, true);
    }

    private void saveWithChoice(ListChoice choice, String note, boolean quick) {
        if (payload == null || busy || hasSaved || uncertain || cancelled || blocked || choice == null) return;
        userNote = note == null ? "" : note;
        busy = true; updateButtons(); setStatus("Preparing…");
        worker.execute(() -> {
            String result;
            try { result = performSave(choice, userNote); }
            catch (Exception error) {
                if (uncertain) result = "The save result is uncertain. Do not retry; return to Obsidian to report the status.";
                else if (error instanceof SecurityException) result = "Supernote storage is unavailable or not authorized. No entry was sent.";
                else result = "Could not prepare this save (" + error.getClass().getSimpleName() + "). No entry was sent; you can try again.";
            }
            boolean autoReturn = quick && hasSaved;
            final String shown = result;
            runOnUiThread(() -> {
                if (isFinishing() || isDestroyed()) return;
                busy = false; setStatus(shown); updateButtons();
                if (autoReturn) returnToObsidian();
            });
        });
    }

    private String performSave(ListChoice choice, String note) throws Exception {
        synchronized (WRITE_LOCK) {
            requireProviderContract();
            DigestRequestStore.Entry prior = store.get(payload.requestId);
            if (prior != null) {
                if (!prior.sha.equals(payloadSha)) { blocked = true; return "This request ID belongs to different content. No write was made."; }
                if (DigestRequestStore.SAVED.equals(prior.status) && prior.savedId > 0) {
                    String priorComment = prior.savedComment == null ? DigestProtocol.manualComment(payload, "") : prior.savedComment;
                    if (verifySavedRow(prior.savedId, priorComment, prior.listAttribute, prior.savedComment != null)) { hasSaved = true; savedId = prior.savedId; return "Saved to Digest (entry " + savedId + ")."; }
                }
                if (!DigestRequestStore.CANCELLED.equals(prior.status)) {
                    if (DigestRequestStore.PENDING.equals(prior.status)) markUncertain(prior); else uncertain = true;
                    return "A previous attempt may have reached the provider. No retry is allowed.";
                }
            } else if (store.count() >= DigestRequestStore.MAX_REQUESTS) return "The local deduplication ledger is full. No write was made.";
            validateSelectedChoice(choice);
            String comment = DigestProtocol.manualComment(payload, note);
            String metadata = DigestProtocol.metadataJson(payload);
            if (comment.length() > 2000 || metadata.length() > DigestProtocol.MAX_METADATA_LENGTH) return "Source details exceed provider limits. Shorten the note; no write was made.";
            ContentValues values = createValues(comment, metadata, choice);
            requireProviderContract();
            if (!store.put(payload.requestId, payloadSha, DigestRequestStore.PENDING, -1, comment, choice.attribute)) return "Could not persist the one-shot guard. Nothing was sent.";
            try {
                uncertain = true;
                Uri ack = getContentResolver().insert(INSERT_URI, values);
                long id = DigestProtocol.parseProviderAcknowledgement(ack == null ? null : ack.toString());
                if (id <= 0 || !verifySavedRow(id, comment, choice.attribute, true)) { markUncertain(comment, choice.attribute); return "The provider result could not be verified for the returned ID. No retry is allowed."; }
                if (!store.put(payload.requestId, payloadSha, DigestRequestStore.SAVED, id, comment, choice.attribute)) {
                    markUncertain(comment, choice.attribute); return "The entry was verified, but its local acknowledgement could not be persisted. Do not retry.";
                }
                uncertain = false; hasSaved = true; savedId = id;
                return "Saved to Digest (entry " + id + "). Choose Return to Obsidian to acknowledge.";
            } catch (Exception e) { markUncertain(comment, choice.attribute); throw e; }
        }
    }

    private void validateSelectedChoice(ListChoice choice) throws Exception {
        List<ListChoice> current = queryLists();
        boolean found = false;
        for (ListChoice actual : current) if (sameChoice(actual, choice)) { found = true; break; }
        if (!found) throw new IllegalStateException("Selected Digest list is no longer available");
    }

    private void markUncertain(DigestRequestStore.Entry entry) { markUncertain(entry.savedComment, entry.listAttribute); }
    private void markUncertain(String comment, String attribute) {
        uncertain = true;
        try { store.put(payload.requestId, payloadSha, DigestRequestStore.UNCERTAIN, -1, comment, attribute); }
        catch (RuntimeException ignored) { }
    }

    private ContentValues createValues(String comment, String metadata, ListChoice choice) {
        ContentValues values = new ContentValues(); values.put("content", payload.text); values.put("source_type", SOURCE_TYPE_SELF_ADD);
        values.put("comment_str", comment); values.put("metadata", metadata);
        if (choice.attribute != null) values.put("knowledge_base_unique_attribute", choice.attribute);
        long now = System.currentTimeMillis(); values.put("state", STATE_ADD); values.put("sync_state", SYNC_NOT_SYNCED);
        values.put("creation_time", now); values.put("last_modified_time", now); return values;
    }

    private boolean verifySavedRow(long id, String expectedComment, String expectedAttribute, boolean enforceListAssociation) {
        try {
            requireProviderContract(); Uri item = Uri.parse("content://" + AUTHORITY + "/knowledge/" + id);
            try (Cursor c = getContentResolver().query(item, null, null, null, null)) {
                if (c == null || c.getCount() != 1 || !c.moveToFirst()) return false;
                int idCol = c.getColumnIndex("id"), textCol = c.getColumnIndex("content"), typeCol = c.getColumnIndex("source_type");
                int commentCol = c.getColumnIndex("comment_str"), metadataCol = c.getColumnIndex("metadata"), listCol = c.getColumnIndex("knowledge_base_unique_attribute");
                if (idCol < 0 || c.getLong(idCol) != id || textCol < 0 || !payload.text.equals(c.getString(textCol))
                        || typeCol < 0 || c.getInt(typeCol) != SOURCE_TYPE_SELF_ADD || commentCol < 0
                        || !expectedComment.equals(c.getString(commentCol)) || metadataCol < 0
                        || !DigestProtocol.metadataMatches(payload, c.getString(metadataCol)) || listCol < 0) return false;
                String actualAttribute = c.isNull(listCol) ? null : c.getString(listCol);
                return DigestProtocol.listAssociationMatches(expectedAttribute, actualAttribute, enforceListAssociation);
            }
        } catch (Exception ignored) { return false; }
    }

    private boolean providerContractReady() {
        ProviderInfo p; try { p = getPackageManager().resolveContentProvider(AUTHORITY, 0); } catch (RuntimeException ignored) { p = null; }
        return p != null && PROVIDER_CLASS.equals(p.name) && KNOWLEDGE_PACKAGE.equals(p.packageName)
                && READ_PERMISSION.equals(p.readPermission) && WRITE_PERMISSION.equals(p.writePermission)
                && checkSelfPermission(READ_PERMISSION) == PackageManager.PERMISSION_GRANTED && checkSelfPermission(WRITE_PERMISSION) == PackageManager.PERMISSION_GRANTED;
    }
    private void requireProviderContract() { if (!providerContractReady()) throw new SecurityException("Provider contract not ready"); }

    private void cancel() {
        if (busy || payload == null || hasSaved || uncertain || blocked) return;
        synchronized (WRITE_LOCK) {
            DigestRequestStore.Entry prior = store.get(payload.requestId);
            if (prior != null && !prior.sha.equals(payloadSha)) { setStatus("This request ID belongs to different content. Cancellation was not recorded."); return; }
            if (prior != null && !DigestRequestStore.CANCELLED.equals(prior.status)) { setStatus("A write attempt has started or completed; cancellation cannot change its result."); return; }
            if (prior == null && store.count() >= DigestRequestStore.MAX_REQUESTS) { setStatus("The local deduplication ledger is full. Cancellation was not recorded."); return; }
            if (prior == null && !store.put(payload.requestId, payloadSha, DigestRequestStore.CANCELLED, -1, null, null)) { setStatus("Cancellation could not be recorded."); return; }
            cancelled = true;
        }
        setStatus("Cancelled before any provider write. Returning to Obsidian…"); updateButtons(); returnToObsidian();
    }

    private void returnToObsidian() {
        if (payload == null || busy) return;
        String result, id = null;
        if (hasSaved) { result = "saved"; id = Long.toString(savedId); } else if (uncertain) result = "uncertain"; else if (cancelled) result = "cancelled"; else return;
        Uri.Builder builder = new Uri.Builder().scheme("obsidian").authority("md-reader-digest-result")
                .appendQueryParameter("vault", payload.origin.vault).appendQueryParameter("request", payload.requestId).appendQueryParameter("status", result);
        if (id != null) builder.appendQueryParameter("id", id);
        if (id != null && quickAuthorized && envelope != null && envelope.client != null) builder.appendQueryParameter("quick", envelope.client);
        try { startActivity(new Intent(Intent.ACTION_VIEW, builder.build())); finish(); }
        catch (RuntimeException e) { setStatus("No Obsidian acknowledgement handler opened (" + e.getClass().getSimpleName() + "). You can return manually."); }
    }

    private void openOriginalNotebook() {
        if (payload == null || payload.note == null || !hasSaved || busy) return;
        Uri target = new Uri.Builder().scheme("supernote-transcripts").authority("open-note").appendQueryParameter("file", payload.note.path).appendQueryParameter("page", Integer.toString(payload.note.page)).build();
        try { startActivity(new Intent(this, OpenNoteActivity.class).setAction(Intent.ACTION_VIEW).setData(target)); }
        catch (RuntimeException e) { setStatus("Could not open the notebook (" + e.getClass().getSimpleName() + ")."); }
    }

    private void saveSelectedDefault() {
        ListChoice selected = selectedChoice(); if (selected == null) { setStatus("Refresh and choose a valid Digest list first."); return; }
        try { persistDefault(selected); setStatus("Quick Digest default saved: " + selected.label + "."); }
        catch (Exception e) { setStatus("Could not save the default list (" + e.getClass().getSimpleName() + ")."); }
    }
    private void populateTrustedClients(LinearLayout container) {
        container.removeAllViews(); revokeButtons.clear();
        List<String> clients = trustStore.clients();
        if (clients.isEmpty()) addText(container, "No Reader clients are trusted.", 14, 4, 8);
        for (String client : clients) {
            QuickTrustStore.Entry entry = trustStore.get(client);
            String vault = entry == null ? "unavailable" : entry.vault;
            LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
            TextView label = new TextView(this); label.setText(vault + " · " + client.substring(0, 8) + "…"); label.setTextSize(14);
            row.addView(label, new LinearLayout.LayoutParams(0, -2, 1));
            Button revoke = new Button(this); revoke.setText("Revoke"); revoke.setOnClickListener(v -> {
                if (trustStore.revoke(client)) { setStatus("Quick Digest client revoked."); populateTrustedClients(container); }
                else setStatus("Could not revoke this client.");
            }); row.addView(revoke); container.addView(row); revokeButtons.add(revoke);
        }
        if (revokeAllButton != null) revokeAllButton.setEnabled(!clients.isEmpty());
    }
    private void revokeAllQuickClients() {
        if (trustStore.revokeAll()) { setStatus("All Quick Digest clients revoked."); if (trustedClientsContainer != null) populateTrustedClients(trustedClientsContainer); }
        else setStatus("Could not revoke Quick Digest clients.");
    }

    private void updateButtons() {
        if (settingsMode) {
            if (setDefaultButton != null) setDefaultButton.setEnabled(listsReady && !busy && selectedChoice() != null);
            if (refreshButton != null) refreshButton.setEnabled(!busy);
            if (revokeAllButton != null) revokeAllButton.setEnabled(!busy && trustStore.clientCount() > 0);
            if (doneButton != null) doneButton.setEnabled(!busy);
            return;
        }
        boolean outcome = hasSaved || uncertain || cancelled;
        boolean canReview = payload != null && !outcome && !blocked;
        boolean selectionReady = listsReady && selectedChoice() != null;
        if (saveButton != null) {
            saveButton.setText(quickSetupPending ? "Save once" : "Save Digest");
            saveButton.setVisibility(canReview ? View.VISIBLE : View.GONE);
            saveButton.setEnabled(canReview && !busy && selectionReady && manualCommentLength(userNote) <= 2000);
        }
        if (approveQuickButton != null) { approveQuickButton.setVisibility(canReview && quickSetupPending ? View.VISIBLE : View.GONE); approveQuickButton.setEnabled(canReview && !busy && selectionReady && manualCommentLength(userNote) <= 2000); }
        if (cancelButton != null) { cancelButton.setVisibility(canReview ? View.VISIBLE : View.GONE); cancelButton.setEnabled(canReview && !busy); }
        if (returnButton != null) { returnButton.setVisibility(payload != null && outcome ? View.VISIBLE : View.GONE); returnButton.setEnabled(payload != null && !busy && outcome); }
        if (openNotebookButton != null) { openNotebookButton.setVisibility(payload != null && payload.note != null && hasSaved ? View.VISIBLE : View.GONE); openNotebookButton.setEnabled(!busy && hasSaved); }
        if (refreshButton != null) refreshButton.setEnabled(!busy);
        if (listSpinner != null) listSpinner.setEnabled(!busy && listsReady);
        if (noteInput != null) noteInput.setEnabled(!busy && canReview);
        if (defaultCheck != null) defaultCheck.setEnabled(!busy && canReview);
    }
    private void setStatus(String value) { if (status != null) status.setText(value); }
    private static String sha256(String input) throws Exception {
        byte[] bytes = MessageDigest.getInstance("SHA-256").digest(input.getBytes("UTF-8"));
        StringBuilder out = new StringBuilder(64); for (byte b : bytes) out.append(String.format(Locale.ROOT, "%02x", b & 0xff)); return out.toString();
    }

    @Override protected void onDestroy() {
        worker.shutdown();
        if (store != null) {
            DigestRequestStore closingStore = store;
            Thread closer = new Thread(() -> {
                try { while (!worker.isTerminated()) worker.awaitTermination(1, java.util.concurrent.TimeUnit.DAYS); }
                catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
                closingStore.close();
            }, "DigestStoreCloser");
            closer.setDaemon(true); closer.start();
        }
        super.onDestroy();
    }

    private static final class ListChoice {
        final long id; final String name, attribute, label;
        ListChoice(long id, String name, String attribute) {
            this.id = id; this.name = name; this.attribute = attribute;
            this.label = name;
        }
        @Override public String toString() { return label; }
    }
}

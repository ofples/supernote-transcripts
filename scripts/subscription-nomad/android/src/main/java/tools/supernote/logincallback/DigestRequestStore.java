package tools.supernote.logincallback;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

/** Durable deduplication state. Never stores request text or source excerpts. */
final class DigestRequestStore extends SQLiteOpenHelper {
    static final int MAX_REQUESTS = 10000;
    static final String PENDING = "PENDING";
    static final String CANCELLED = "CANCELLED";
    static final String UNCERTAIN = "UNCERTAIN";
    static final String SAVED = "SAVED";

    DigestRequestStore(Context context) { super(context, "digest_requests.db", null, 2); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE requests (request_id TEXT PRIMARY KEY NOT NULL, payload_sha TEXT NOT NULL, status TEXT NOT NULL, saved_id INTEGER NOT NULL DEFAULT -1, updated_at INTEGER NOT NULL, saved_comment TEXT, list_attribute TEXT)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE requests ADD COLUMN saved_comment TEXT");
            db.execSQL("ALTER TABLE requests ADD COLUMN list_attribute TEXT");
        }
    }

    Entry get(String requestId) {
        try (Cursor c = getReadableDatabase().query("requests", new String[]{"payload_sha", "status", "saved_id", "saved_comment", "list_attribute"}, "request_id=?", new String[]{requestId}, null, null, null)) {
            if (!c.moveToFirst()) return null;
            return new Entry(c.getString(0), c.getString(1), c.getLong(2), c.isNull(3) ? null : c.getString(3), c.isNull(4) ? null : c.getString(4));
        }
    }

    int count() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM requests", null)) { return c.moveToFirst() ? c.getInt(0) : MAX_REQUESTS; }
    }

    boolean put(String requestId, String sha, String status, long savedId, String savedComment, String listAttribute) {
        ContentValues values = new ContentValues();
        values.put("request_id", requestId); values.put("payload_sha", sha); values.put("status", status);
        values.put("saved_id", savedId); values.put("updated_at", System.currentTimeMillis());
        if (savedComment != null) values.put("saved_comment", savedComment); else values.putNull("saved_comment");
        if (listAttribute != null) values.put("list_attribute", listAttribute); else values.putNull("list_attribute");
        return getWritableDatabase().insertWithOnConflict("requests", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1;
    }

    static final class Entry {
        final String sha, status, savedComment, listAttribute; final long savedId;
        Entry(String sha, String status, long savedId, String savedComment, String listAttribute) {
            this.sha = sha; this.status = status; this.savedId = savedId; this.savedComment = savedComment; this.listAttribute = listAttribute;
        }
    }
}

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

    DigestRequestStore(Context context) { super(context, "digest_requests.db", null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE requests (request_id TEXT PRIMARY KEY NOT NULL, payload_sha TEXT NOT NULL, status TEXT NOT NULL, saved_id INTEGER NOT NULL DEFAULT -1, updated_at INTEGER NOT NULL)");
    }

    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { }

    Entry get(String requestId) {
        try (Cursor c = getReadableDatabase().query("requests", new String[]{"payload_sha", "status", "saved_id"}, "request_id=?", new String[]{requestId}, null, null, null)) {
            if (!c.moveToFirst()) return null;
            return new Entry(c.getString(0), c.getString(1), c.getLong(2));
        }
    }

    int count() {
        try (Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM requests", null)) { return c.moveToFirst() ? c.getInt(0) : MAX_REQUESTS; }
    }

    boolean put(String requestId, String sha, String status, long savedId) {
        ContentValues values = new ContentValues();
        values.put("request_id", requestId); values.put("payload_sha", sha); values.put("status", status);
        values.put("saved_id", savedId); values.put("updated_at", System.currentTimeMillis());
        return getWritableDatabase().insertWithOnConflict("requests", null, values, SQLiteDatabase.CONFLICT_REPLACE) != -1;
    }

    static final class Entry {
        final String sha, status; final long savedId;
        Entry(String sha, String status, long savedId) { this.sha = sha; this.status = status; this.savedId = savedId; }
    }
}

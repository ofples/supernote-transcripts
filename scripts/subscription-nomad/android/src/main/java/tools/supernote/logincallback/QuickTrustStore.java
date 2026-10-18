package tools.supernote.logincallback;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Device-local enrollment secrets encrypted by an Android Keystore AES key. */
final class QuickTrustStore {
    static final int MAX_CLIENTS = 8;
    private static final String PREFS = "digest_quick_trust";
    private static final String ALIAS = "supernote_bridge_reader_quick_trust_v1";
    private final SharedPreferences prefs;
    private final Context context;

    QuickTrustStore(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    synchronized Entry get(String client) {
        String vault = prefs.getString(client + ".vault", null);
        String encoded = prefs.getString(client + ".secret", null);
        if (vault == null || encoded == null) return null;
        try {
            byte[] sealed = Base64.getDecoder().decode(encoded);
            if (sealed.length < 13) return null;
            ByteBuffer buffer = ByteBuffer.wrap(sealed);
            byte[] iv = new byte[12]; buffer.get(iv);
            byte[] ciphertext = new byte[buffer.remaining()]; buffer.get(ciphertext);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, getKey(), new GCMParameterSpec(128, iv));
            cipher.updateAAD(client.getBytes(StandardCharsets.US_ASCII));
            byte[] secret = cipher.doFinal(ciphertext);
            return secret.length == 32 ? new Entry(vault, secret) : null;
        } catch (Exception ignored) { return null; }
    }

    synchronized boolean put(String client, String vault, byte[] secret) {
        if (client == null || !client.matches("[0-9a-f]{32}") || vault == null || vault.length() < 1 || vault.length() > 256 || secret == null || secret.length != 32) return false;
        if (!prefs.contains(client + ".vault") && clientCount() >= MAX_CLIENTS) return false;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getKey());
            cipher.updateAAD(client.getBytes(StandardCharsets.US_ASCII));
            byte[] ciphertext = cipher.doFinal(secret);
            byte[] iv = cipher.getIV();
            ByteBuffer sealed = ByteBuffer.allocate(iv.length + ciphertext.length).put(iv).put(ciphertext);
            return prefs.edit().putString(client + ".vault", vault)
                    .putString(client + ".secret", Base64.getEncoder().encodeToString(sealed.array())).commit();
        } catch (Exception ignored) { return false; }
    }

    synchronized int clientCount() {
        int count = 0;
        for (String key : prefs.getAll().keySet()) if (key.endsWith(".vault")) count++;
        return count;
    }

    synchronized List<String> clients() {
        List<String> result = new ArrayList<>();
        for (String key : prefs.getAll().keySet()) if (key.endsWith(".vault")) result.add(key.substring(0, key.length() - 6));
        return result;
    }

    synchronized boolean revoke(String client) {
        return prefs.edit().remove(client + ".vault").remove(client + ".secret").commit();
    }

    synchronized boolean revokeAll() {
        return prefs.edit().clear().commit();
    }

    private SecretKey getKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        java.security.Key existing = store.getKey(ALIAS, null);
        if (existing instanceof SecretKey) return (SecretKey) existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build());
        return generator.generateKey();
    }

    static final class Entry {
        final String vault;
        final byte[] secret;
        Entry(String vault, byte[] secret) { this.vault = vault; this.secret = secret; }
    }
}

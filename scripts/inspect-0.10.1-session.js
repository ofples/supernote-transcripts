(() => {
  const p = app.plugins.plugins["nomad-transcripts"];
  if (!p || p.manifest.version !== "0.10.1") throw new Error("Expected active 0.10.1 plugin");
  const session = p.session;
  const record = session.record ?? {};
  const tokens = record.tokens ?? {};
  const pending = record.pending;
  const now = Date.now();
  const result = {
    version: p.manifest.version,
    pluginConnected: !!p.subscriptionStatus.connected,
    pluginStatus: String(p.subscriptionStatus.status ?? ""),
    sessionConnected: !!session.connected,
    sessionStatus: String(session.status ?? ""),
    secureRecordLoaded: !!session.loaded,
    recordExists: !!record.hostId,
    clientRegistrationPresent: !!record.clientId,
    identityPresent: !!record.subject,
    tokensPresent: !!record.tokens,
    accessTokenPresent: typeof tokens.accessToken === "string" && tokens.accessToken.length > 0,
    refreshTokenPresent: typeof tokens.refreshToken === "string" && tokens.refreshToken.length > 0,
    tokenExpired: Number.isFinite(tokens.expiresAt) ? tokens.expiresAt <= now : null,
    tokenNearExpiry: Number.isFinite(tokens.expiresAt) ? tokens.expiresAt <= now + 120000 : null,
    refreshAllowedByServerTime: Number.isFinite(tokens.earliestRefreshAt) ? tokens.earliestRefreshAt <= now : null,
    renewalBlocked: !!record.renewalBlocked,
    pendingExists: !!pending,
    pendingFresh: !!pending && !pending.used && Number.isFinite(pending.created) && now - pending.created < 600000,
    pendingUsed: !!pending?.used,
    callbackListenerExists: !!session.server,
    callbackListenerActive: !!session.server?.listening,
    progressPaused: !!p.progress.paused,
    progressIdle: !p.task && !p.progress.running,
    recognitionRequestsThisRun: p.callsThisRun ?? 0,
  };
  globalThis.__desktop0101SessionStatus = result;
  return result;
})();

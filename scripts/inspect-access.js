(async () => {
  const a = app.vault.adapter;
  return {
    fields: Object.keys(a),
    read: a.readBinary.toString(),
    full: a.getFullPath.toString(),
    real: a.getFullRealPath.toString(),
    native: a.getNativePath.toString(),
    cordovaKeys: Object.keys(cordova),
    syncName: app.internalPlugins.plugins.sync?.instance?.remoteVault?.name,
  };
})();

({
  configDir: app.vault.configDir,
  pluginsDir: app.plugins.getPluginFolder?.(),
  vaultName: app.vault.getName(),
  base: app.vault.adapter.basePath,
});

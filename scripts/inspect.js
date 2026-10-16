JSON.stringify({
  vault: app.vault.getName(),
  adapter: app.vault.adapter.constructor.name,
  methods: Object.getOwnPropertyNames(Object.getPrototypeOf(app.vault.adapter)),
  cordova: typeof cordova,
  resolve: typeof window.resolveLocalFileSystemURL,
  base: app.vault.adapter.basePath,
  plugins: Object.keys(app.plugins.plugins),
});

(()=>{
 const s=app.secretStorage;
 return {secretStorageMethods:Object.getOwnPropertyNames(Object.getPrototypeOf(s)),
 getSecret:s.getSecret?.toString(),setSecret:s.setSecret?.toString(),
 safeStorageFields:Object.keys(s).filter(k=>/adapter|storage|prefix/i.test(k)),
 appInfo:{version:app.version},
 securePluginMethods:['internalGetItem','internalSetItem'].map(k=>({name:k,available:typeof window.Capacitor.Plugins.SecureStorage[k]}))};
})();

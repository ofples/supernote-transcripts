Object.fromEntries(
  Object.getOwnPropertyNames(Object.getPrototypeOf(app.vault.adapter.fs)).map(
    (k) => [
      k,
      typeof app.vault.adapter.fs[k] === "function"
        ? app.vault.adapter.fs[k].toString()
        : typeof app.vault.adapter.fs[k],
    ],
  ),
);

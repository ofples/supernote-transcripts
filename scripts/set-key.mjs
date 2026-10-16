const key = process.env.OPENAI_API_KEY;
if (!key)
  throw new Error(
    "OPENAI_API_KEY is unavailable in the refreshed environment.",
  );
const targets = await (await fetch("http://127.0.0.1:19222/json/list")).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
ws.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      expression: `(()=>{const p=app.plugins.plugins['nomad-transcripts'];p.apiKey=${JSON.stringify(key)};return !!p.apiKey})()`,
      returnByValue: true,
    },
  }),
);
await new Promise((r, j) => {
  const t = setTimeout(() => {
    ws.close();
    j(new Error("Key setup timed out"));
  }, 15000);
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id === 1) {
      clearTimeout(t);
      console.log(
        m.result?.result?.value === true
          ? "Device-local API key configured."
          : "Key setup failed.",
      );
      ws.close();
      r();
    }
  };
});

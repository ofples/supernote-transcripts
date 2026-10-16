import { readFile } from "node:fs/promises";
const targets = await (await fetch("http://127.0.0.1:19222/json/list")).json();
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
const expression = await readFile(process.argv[2], "utf8");
ws.send(
  JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: { expression, awaitPromise: true, returnByValue: true },
  }),
);
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    ws.close();
    reject(new Error("Diagnostic timeout"));
  }, 180000);
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id === 1) {
      clearTimeout(timer);
      console.log(JSON.stringify(msg.result));
      ws.close();
      resolve();
    }
  };
});

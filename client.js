const net = require("net");
const http = require("http");
const fs = require("fs");
const fsPromises = require("fs").promises;
const WebSocket = require("ws");
const { exec } = require("child_process");

const SERVER_HOST = "172.20.10.8";
const HTTP_HOST = "localhost";
const SERVER_PORT = 8001;
const HTTP_PORT = 8002;
const WS_PORT = 8081;

// ==== HTTP SERVER ====
let indexFile;

const httpServer = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.writeHead(200);
  res.end(indexFile);
});

fsPromises.readFile(__dirname + "/client.html")
  .then((contents) => {
    indexFile = contents;
    httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
      console.log(`Client UI: http://${HTTP_HOST}:${HTTP_PORT}`);
    });
  });

// ==== WEBSOCKET SERVER ====
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket UI ws://${HTTP_HOST}:${WS_PORT}`);

function broadcast(data) {
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify(data));
    }
  });
}

// ==== CLIENT TCP ====

const CLIENT_ID = process.argv[2]
  ? process.argv[2]
  : Math.floor(Math.random() * 1000);

let localOffset = 0;

const client = new net.Socket();

client.connect(SERVER_PORT, SERVER_HOST, () => {
  console.log(`[${CLIENT_ID}] Terhubung ke server ${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`[${CLIENT_ID}] Waktu lokal awal: ${new Date().toLocaleString()}`);
});

client.on("data", (data) => {
  const msg = data.toString().trim();

  // ==== REQUEST TIME FROM SERVER ====
  if (msg === "REQ_TIME") {
    const now = Date.now();
    console.log(`[${CLIENT_ID}] Server meminta waktu, mengirim TIME ${now}`);
    client.write(`TIME ${now}`);
    return;
  }

  // ==== SERVER OFFSET ====
  if (msg.startsWith("AVG")) {
    const parts = msg.split(" ");
    const avg = Number(parts[1]);
    // const offset = parseFloat(msg.split(" ")[1]);
    if (isNaN(avg)) {
      console.log(`[${CLIENT_ID}] AVG tidak valid: ${msg}`);
      return;
    }

    const beforeSync = Date.now();
    const offset = avg - beforeSync;

    console.log(`[${CLIENT_ID}] Offset diterima: ${offset} ms`);

    const adjusted = beforeSync + offset;

    console.log(`[${CLIENT_ID}] Waktu sebelum sinkronisasi: ${new Date(beforeSync).toLocaleString()}`);
    console.log(`[${CLIENT_ID}] Waktu setelah sinkronisasi (internal): ${new Date(adjusted).toLocaleString()}`);

    // ==== OPSIONAL: SET TIME OS WINDOWS ====
    applyWindowsTime(avg);

    broadcast({
      type: "sync_result",
      client_id: CLIENT_ID,
      local_time_before: new Date(beforeSync).toISOString(),
      offset_ms: offset,
      adjusted_time: new Date(adjusted).toISOString(),
      server: SERVER_HOST,
    });

    return;
  }

  console.log(`[${CLIENT_ID}] Pesan tidak dikenali: ${msg}`);
});

// ==== UPDATE WAKTU WINDOWS ====
function applyWindowsTime(timestampMs) {
  const dateObj = new Date(timestampMs);

  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, "0");
  const dd = String(dateObj.getDate()).padStart(2, "0");

  const hh = String(dateObj.getHours()).padStart(2, "0");
  const mi = String(dateObj.getMinutes()).padStart(2, "0");
  const ss = String(dateObj.getSeconds()).padStart(2, "0");

  // Format Set-Date Windows
  const winDate = `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;

  const cmd = `powershell.exe -Command "Set-Date -Date '${winDate}'"`;

  console.log(`[${CLIENT_ID}] Menerapkan waktu OS Windows: ${winDate}`);

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error(`[${CLIENT_ID}] Gagal mengubah waktu OS (perlu run as Administrator):`, err.message);
      return;
    }
    console.log(`[${CLIENT_ID}] Waktu OS berhasil diperbarui`);
  });
}

client.on("close", () => {
  console.log(`[${CLIENT_ID}] Koneksi ditutup`);
});

client.on("error", (err) => {
  console.error(`[${CLIENT_ID}] ERROR:`, err.message);
});

const net = require("net");
const http = require("http");
const fs = require("fs");
const fsPromises = require('fs').promises;
const WebSocket = require('ws');

const SERVER_HOST = "localhost";
const SERVER_PORT = 8001;
const HTTP_PORT = 8002;
const WS_PORT = 8081;

const requestListener = function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(indexFile);
};

const httpServer = http.createServer(requestListener);

fsPromises.readFile(__dirname + "/client.html")
  .then(contents => {
      indexFile = contents;
      httpServer.listen(HTTP_PORT, SERVER_HOST, () => {
          console.log(`Server is running on http://${HTTP_PORT}:${SERVER_HOST}`);
      });
  })
  .catch(err => {
      console.error(`Could not read index.html file: ${err}`);
      process.exit(1);
  });

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket Server: ws://${SERVER_HOST}:${WS_PORT}`);

// ID klien diambil dari argumen command line
const CLIENT_ID = process.argv[2] ? process.argv[2] : Math.floor(Math.random() * 100);

// Lokasi penyimpanan hasil sinkronisasi
const LOG_FILE = `sync_client_${CLIENT_ID}.json`;

const client = new net.Socket();

client.connect(SERVER_PORT, SERVER_HOST, () => {
  console.log(`[${CLIENT_ID}] Terhubung ke server di ${SERVER_HOST}:${SERVER_PORT}`);
  console.log(`[${CLIENT_ID}] Waktu lokal awal: ${new Date().toLocaleString()}`);
});

let localOffset = 0;

client.on("data", (data) => {
  const message = data.toString().trim();
  let localTime = Date.now() + localOffset;
  
  if (message === "REQ_TIME") {
    console.log(`[${CLIENT_ID}] Server meminta waktu, mengirim: ${localTime}`);
    client.write(localTime.toString());
  } else {
    const offset = parseFloat(message);
    if (isNaN(offset)) {
      console.log(`[${CLIENT_ID}] Pesan tidak dikenali dari server: ${message}`);
      return;
    }
    localOffset += offset;
    const adjustedTime = localTime + offset;

    console.log(`[${CLIENT_ID}] Offset diterima: ${offset} ms`);
    console.log(`[${CLIENT_ID}] Waktu sebelum sinkronisasi: ${new Date().toLocaleString()}`);
    console.log(`[${CLIENT_ID}] Waktu setelah sinkronisasi: ${new Date(adjustedTime).toLocaleString()}\n`);

    // Simpan hasil sinkronisasi ke file
    const syncData = {
      client_id: CLIENT_ID,
      local_time_before: new Date().toISOString(),
      offset_ms: offset,
      adjusted_time: new Date(adjustedTime).toISOString(),
      server: SERVER_HOST,
    };

    fs.writeFileSync(LOG_FILE, JSON.stringify(syncData, null, 2));
  }
});

client.on("close", () => {
  console.log(`[${CLIENT_ID}] Koneksi ke server ditutup`);
});

client.on("error", (err) => {
  console.error(`[${CLIENT_ID}] Terjadi kesalahan:`, err.message);
});
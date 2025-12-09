const net = require("net");
const http = require("http");
const fs = require('fs').promises;
const WebSocket = require("ws");
const { exec } = require("child_process");

const HTTP_HOST = "localhost";
const HTTP_PORT = 8000;
const TCP_PORT = 8001;
const WS_PORT = 8080;

let clients = [];
let clientsIP = [];
let rttMeasurements = {};   // RTT per klien
let clientTimes = {};       // waktu klien (setelah dikoreksi)
let indexFile;

// ==== HTTP SERVER ====

const requestListener = (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.writeHead(200);
  res.end(indexFile);
};

const httpServer = http.createServer(requestListener);

fs.readFile(__dirname + "/server.html")
  .then(contents => {
    indexFile = contents;
    httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
      console.log(`Server running at http://${HTTP_HOST}:${HTTP_PORT}`);
    });
  });

// ==== WEBSOCKET ====
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket Server: ws://${HTTP_HOST}:${WS_PORT}`);

function broadcast(data) {
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      c.send(JSON.stringify(data));
    }
  });
}

function fmtTime(ms) {
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return `invalid(${ms})`;
  const time = d.toLocaleTimeString('id-ID', { hour12: false });
  const msPart = String(d.getMilliseconds()).padStart(3, '0');
  return `${time}.${msPart} (ms:${ms})`;
}

// ==== TCP SERVER (BERKELEY) ====

const server = net.createServer((socket) => {
  const ip = socket.remoteAddress;
  console.log("Klien terhubung:", ip);

  clients.push(socket);
  clientsIP.push(ip);

  socket.on("data", (data) => {
    const msg = data.toString();

    // 1. Jika klien mengirim TIME <timestamp>
    if (msg.startsWith("TIME")) {
      const parts = msg.split(" ");
      const clientSendTime = Number(parts[1]);   // waktu klien saat mengirim
      const serverReceiveTime = Date.now();

      // Hitung RTT/2
      const rtt = serverReceiveTime - rttMeasurements[ip];
      const delay = rtt / 2;

      // Koreksi waktu klien
      const correctedClientTime = clientSendTime + delay;

      clientTimes[ip] = correctedClientTime;

      console.log(`Data dari ${ip}`);
      // console.log("  Client send:", clientSendTime);
      // console.log("  Server recv:", serverReceiveTime);
      // console.log("  RTT:", rtt, "ms");
      // console.log("  Delay:", delay, "ms");
      // console.log("  Corrected:", correctedClientTime);
      console.log(`  Client send:       ${fmtTime(clientSendTime)}`) ;
      console.log(`  Server recv:       ${fmtTime(serverReceiveTime)}`);
      console.log(`  RTT:               ${rtt} ms`);
      console.log(`  Delay (RTT/2):     ${delay} ms`);
      console.log(`  Corrected client:  ${fmtTime(correctedClientTime)}`);

      // Jika semua data masuk
      if (Object.keys(clientTimes).length === clients.length) {
        executeBerkeley();
      }
    }
  });
});

// ==== FUNGSI UTAMA BERKELEY ====

function executeBerkeley() {
  const serverTime = Date.now();
  
  // Ambil semua waktu klien
  const times = Object.values(clientTimes);
  
  if (times.length === 0) return;

  const allTimes = times.concat([serverTime]);

  // Hitung rata-rata waktu klien (Berkeley standard)
  // const avg = times.reduce((a, b) => a + b) / times.length;
  const avg = allTimes.reduce((a, b) => a + b) / allTimes.length;

  console.log("\n=== HASIL SINKRONISASI (BERKELEY) ===");
  console.log("Server time:", fmtTime(serverTime));
  console.log("Client corrected times:");
  Object.entries(clientTimes).forEach(([ip, t]) => {
    console.log(`  ${ip}: ${fmtTime(t)}`);
  });
  console.log("Average :", fmtTime(avg));

  // Hitung offset klien
  let offsets = {};
  clientsIP.forEach(ip => {
    offsets[ip] = avg - clientTimes[ip];
  });

  // Offset server (optional)
  const serverOffset = avg - serverTime;

  console.log("Offsets:", offsets);
  console.log("Server offset:", serverOffset);

  // Broadcast ke WebSocket
  broadcast({
    type: "sync_result",
    clientsIP,
    avgTime: avg,
    offsets,
    serverOffset,
    timestamp: new Date().toLocaleTimeString()
  });

  // Kirim offset ke masing-masing klien
  clients.forEach((client, i) => {
    const ip = clientsIP[i];
    const payload = {
      type : "berkeley_sync",
      avgTime : Number(avg),
      offset: Number(offsets[ip] ?? 0),
      serverOffset: Number(serverOffset)
    }
    client.write(JSON.stringify(payload) + "\n");
  });

  // Reset untuk sinkronisasi berikutnya
  clientTimes = {};
  rttMeasurements = {};

  const epochSeconds = Math.floor(avg / 1000);
  exec(`sudo date -s @${epochSeconds}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error: ${error.message}`);
      return;
    }
    console.log("Waktu sistem diperbarui:", stdout.trim());
  });
}

// ==== TRIGGER SYNC ====
function startSync() {
  if (clients.length === 0) {
    console.log("Tidak ada klien, menunggu...");
    return;
  }

  console.log("\n=== MULAI SINKRONISASI BERKELEY ===");

  clientTimes = {};
  rttMeasurements = {};

  clients.forEach((client, i) => {
    const ip = clientsIP[i];
    
    // Catat waktu server saat request dikirim
    rttMeasurements[ip] = Date.now();

    // Kirim permintaan waktu
    client.write("REQ_TIME");
  });
}

server.listen(TCP_PORT, () => {
  console.log(`TCP Server berjalan di port ${TCP_PORT}`);

  // Sync otomatis tiap 5 menit
  setInterval(startSync, 30 * 1000);

  // Sync pertama setelah server hidup
  setTimeout(startSync, 2000);
});

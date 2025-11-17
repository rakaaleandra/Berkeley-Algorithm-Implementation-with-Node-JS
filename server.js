const net = require("net");
const http = require("http");
const fs = require('fs').promises;
const WebSocket = require('ws');

const HTTP_HOST = "localhost";
const HTTP_PORT = 8000;
const TCP_PORT = 8001;
const WS_PORT = 8080;

let clients = [];
let clientsIP = [];
let clientTimes = [];
let indexFile;

const requestListener = function (req, res) {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(indexFile);
};

const httpServer = http.createServer(requestListener);

fs.readFile(__dirname + "/server.html")
  .then(contents => {
      indexFile = contents;
      httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
          console.log(`Server is running on http://${HTTP_PORT}:${HTTP_HOST}`);
      });
  })
  .catch(err => {
      console.error(`Could not read index.html file: ${err}`);
      process.exit(1);
  });

const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket Server: ws://${HTTP_HOST}:${WS_PORT}`);

function broadcast(data) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

const server = net.createServer((socket) => {
  console.log("Klien terhubung:", socket.remoteAddress);
  clients.push(socket);
  clientsIP.push(socket.remoteAddress);

  // broadcast({
  //   type: "sync_progress",
  //   clientsIP
  // });
  if (clients.length > 0) {
    console.log("Mulai sinkronisasi waktu...");
    // Kirim permintaan waktu ke semua klien
    clients.forEach((client) => {
      client.write("REQ_TIME");
    });

    // Terima waktu dari klien
    socket.on("data", (data) => {
      const clientTime = parseFloat(data);
      console.log("Waktu dari klien: ", clientTime + " ms");
      clientTimes.push(clientTime);

      // Jika semua waktu sudah diterima
      if (clientTimes.length === clients.length) {
        const serverTime = Date.now();
        const allTimes = [...clientTimes, serverTime];
        const avgTime =
          allTimes.reduce((a, b) => a + b, 0) / allTimes.length;

        // Hitung offset
        const offsets = allTimes.map((t) => avgTime - t);

        console.log("\n=== HASIL SINKRONISASI ===");
        console.log("Server offset:", offsets[offsets.length - 1], "ms");

        broadcast({
          type: "sync_result",
          clientsIP,
          avgTime,
          offsets,
          timestamp: new Date().toLocaleTimeString(),
        });

        // Kirim offset ke klien
        clients.forEach((client, index) => {
          client.write(offsets[index].toString());
        });

        // Reset
        // clients = [];
        // clientsIP = [];
        clientTimes = [];

        // Timer On
        // if (timer == 0) {
        //   timer = 300
        // }
      }
    });
  }
});



server.listen(TCP_PORT, () => {
  console.log(`Server berjalan di port ${TCP_PORT}`);

  // Jalankan sinkronisasi otomatis setiap 300 detik (5 menit)
  setInterval(() => {
    if (clients.length > 0) {
      // Reset array waktu
      clientTimes = [];

      // Kirim permintaan waktu ke semua klien
      clients.forEach((client) => {
        client.write("REQ_TIME");
      });


    } else {
      console.log("⚠️ Tidak ada klien yang terhubung, menunggu...");
    }
  // }, 300 * 1000); // setiap 5 menit
  }, 10000); // setiap 5 menit
});

const net = require("net");
const http = require("http");
const fs = require("fs").promises;
const WebSocket = require("ws");

// Konfigurasi
const HTTP_HOST = "localhost";
const HTTP_PORT = 8000;
const TCP_PORT = 8001;
const WS_PORT = 8080;

// State
let clients = [];               // socket
let clientsIP = [];             // ip
let clientTimes = [];           // waktu klien
let clientDelays = [];          // RTT/2
let awaiting = 0;               // jumlah klien yg harus mengirim
let indexFile;

// HTTP server untuk UI
const httpServer = http.createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.writeHead(200);
    res.end(indexFile);
});

fs.readFile(__dirname + "/server.html")
    .then(content => {
        indexFile = content;
        httpServer.listen(HTTP_PORT, HTTP_HOST, () => {
            console.log(`Server running at http://${HTTP_HOST}:${HTTP_PORT}`);
        });
    });

// WebSocket server untuk broadcast
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket ws://${HTTP_HOST}:${WS_PORT}`);

function broadcast(data) {
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify(data));
        }
    });
}

// TCP MASTER SERVER
const server = net.createServer(socket => {
    clients.push(socket);
    clientsIP.push(socket.remoteAddress);

    socket.on("data", data => handleClientResponse(socket, data));
});

server.listen(TCP_PORT, () => {
    console.log(`Berkeley Master berjalan di port ${TCP_PORT}`);

    // sinkronisasi otomatis tiap 5 menit
    setInterval(() => beginSync(), 300 * 1000);
});


// ===============================================================
//               1. MULAI SINKRONISASI
// ===============================================================
function beginSync() {
    if (clients.length === 0) {
        console.log("Tidak ada klien terhubung.");
        return;
    }

    clientTimes = [];
    clientDelays = [];

    console.log("\n=== Mulai Sinkronisasi Berkeley Modified ===");

    awaiting = clients.length;

    clients.forEach((client, idx) => {
        client.sendTimeRequestAt = Date.now(); // waktu permintaan dikirim
        client.write("REQ_TIME");
    });
}


// ===============================================================
//     2. SERVER MENERIMA RESPON WAKTU KLIEN + HITUNG RTT/2
// ===============================================================
function handleClientResponse(socket, data) {
    try {
        const clientTime = parseFloat(data.toString());
        const t_recv = Date.now();

        const idx = clients.indexOf(socket);
        const t_send = socket.sendTimeRequestAt;
        const rtt = t_recv - t_send;

        const delay = rtt / 2;

        clientTimes[idx] = clientTime + delay;  // kompensasi delay
        clientDelays[idx] = delay;

        console.log(`Klien ${clientsIP[idx]} waktu: ${clientTime} ms (RTT=${rtt} ms, delay=${delay} ms)`);

        awaiting--;

        if (awaiting === 0) {
            computeOffsets();
        }

    } catch (err) {
        console.log("Error parsing:", err);
    }
}


// ===============================================================
//   3. HITUNG AVERAGE TIME (Server + Semua Klien)
// ===============================================================
function computeOffsets() {
    const serverTime = Date.now();

    const allTimes = [...clientTimes, serverTime];
    const avgTime = allTimes.reduce((a, b) => a + b, 0) / allTimes.length;

    console.log("\n=== HASIL AVERAGING ===");
    console.log("Waktu server:", serverTime);
    console.log("Times (Klien + Server):", allTimes);
    console.log("Rata-rata:", avgTime);


    // ===============================================================
    // 4. HITUNG OFFSET UNTUK SEMUA NODE
    // ===============================================================
    const offsets = allTimes.map(t => avgTime - t);

    console.log("\n=== OFFSET ===");
    offsets.forEach((off, i) => {
        if (i < clients.length)
            console.log(`Offset klien ${clientsIP[i]}: ${off} ms`);
        else
            console.log(`Offset server: ${off} ms`);
    });

    broadcast({
        type: "sync_result",
        clientsIP,
        avgTime,
        offsets,
        timestamp: new Date().toLocaleTimeString(),
    });

    // Kirim offset ke masing-masing klien
    clients.forEach((client, idx) => {
        client.write(offsets[idx].toString());
    });

    console.log("\n=== Sinkronisasi selesai ===");
}

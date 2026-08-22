/**
 * server.js — Uygulamanın giriş noktası.
 *
 * Burada sadece parçaları bir araya getiriyoruz:
 *   1. Express HTTP sunucusu kur
 *   2. Socket.io'yu HTTP sunucusuna bağla
 *   3. Servisleri oluştur
 *   4. Her yeni bağlantı için handler'ı kayıt et
 *   5. Sunucuyu başlat
 *
 * İş mantığı buraya yazılmaz — o görev servislere ve handler'lara aittir.
 */

const express      = require("express");
const http         = require("http");         // Node.js yerleşik HTTP modülü
const { Server }   = require("socket.io");
const path         = require("path");

const ServerConfig   = require("./src/config/ServerConfig");
const GameService    = require("./src/services/GameService");
const SocketHandler  = require("./src/handlers/SocketHandler");

// ── 1. Express uygulaması ───────────────────────────────────────
const app = express();

// JSON body'leri parse et (REST endpoint'ler için)
app.use(express.json());

// ── 2. HTTP sunucusu ────────────────────────────────────────────
// Socket.io normal Express app'e değil, HTTP sunucusuna bağlanır
const httpServer = http.createServer(app);

// ── 3. Socket.io ────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: ServerConfig.CORS,
});

// ── 4. Servisler ────────────────────────────────────────────────
// GameService io'ya ihtiyaç duyar — odaya broadcast için
const gameService   = new GameService(io);
const socketHandler = new SocketHandler(io, gameService);

// ── 5. Bağlantı dinleyicisi ─────────────────────────────────────
io.on("connection", (socket) => {
  // Her yeni bağlanan client için handler'ı kayıt et
  socketHandler.register(socket);
});

// ── 6. REST endpoint'ler (opsiyonel) ────────────────────────────
// Sağlık kontrolü — "sunucu çalışıyor mu?" diye sormak için
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── 7. Frontend static dosyaları (opsiyonel) ────────────────────
// Backend ile frontend'i tek sunucudan servis etmek istersen:
// app.use(express.static(path.join(__dirname, "../")));
// şimdilik kapalı — geliştirme sırasında frontend ayrı çalışır

// ── 8. Sunucuyu başlat ──────────────────────────────────────────
httpServer.listen(ServerConfig.PORT, () => {
  console.log("─────────────────────────────────────");
  console.log(`  VOID Server çalışıyor`);
  console.log(`  http://localhost:${ServerConfig.PORT}`);
  console.log("─────────────────────────────────────");
});

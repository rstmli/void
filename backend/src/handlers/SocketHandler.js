const roomService    = require("../services/RoomService");
const { ROOM_STATE } = require("../models/Room");

class SocketHandler {
  constructor(io, gameService) {
    this.io          = io;
    this.gameService = gameService;
  }

  register(socket) {
    console.log(`[Socket] Bağlandı: ${socket.id}`);
    this._registerRoomEvents(socket);
    this._registerGameEvents(socket);
    this._registerChatEvents(socket);
    this._registerDisconnect(socket);
  }

  // ─── Room ──────────────────────────────────────────────────────

  _registerRoomEvents(socket) {

    socket.on("room:create", ({ name }) => {
      if (!name?.trim()) return socket.emit("error", { message: "Ad boş ola bilməz" });

      const room   = roomService.createRoom();
      const result = roomService.joinRoom(socket.id, name.trim(), room.code);
      if (!result.success) return socket.emit("error", { message: result.error });

      socket.join(room.code);
      socket.emit("room:created", { code: room.code, room: room.toPublic() });
    });

    socket.on("room:join", ({ name, code }) => {
      if (!name?.trim() || !code?.trim())
        return socket.emit("error", { message: "Ad və kod tələb olunur" });

      const result = roomService.joinRoom(socket.id, name.trim(), code.trim().toUpperCase());
      if (!result.success) return socket.emit("error", { message: result.error });

      socket.join(result.room.code);
      socket.emit("room:joined", { room: result.room.toPublic() });
      socket.to(result.room.code).emit("room:player_joined", { room: result.room.toPublic() });
    });

    // Hazır toggle
    socket.on("room:ready", () => {
      const room = roomService.findRoomBySocket(socket.id);
      if (!room) return;
      roomService.toggleReady(socket.id);
      this.io.to(room.code).emit("room:updated", { room: room.toPublic() });
    });

    // Host oda ayarlarını değiştirir
    socket.on("room:settings", (settings) => {
      const result = roomService.updateSettings(socket.id, settings);
      if (!result.success) return socket.emit("error", { message: result.error });
      this.io.to(result.room.code).emit("room:updated", { room: result.room.toPublic() });
    });

    // Oyunu başlat — sadece host, herkes hazırsa (host hariç)
    socket.on("room:start", ({ code }) => {
      const room = roomService.findRoom(code);
      if (!room)  return socket.emit("error", { message: "Oda tapılmadı" });

      // Bitti ya da waiting state'inde olmalı
      if (![ROOM_STATE.WAITING, ROOM_STATE.FINISHED].includes(room.state)) {
        return socket.emit("error", { message: "Oyun artıq başlayıb" });
      }

      const player = room.getPlayer(socket.id);
      if (!player?.isHost) return socket.emit("error", { message: "Yalnız host başlada bilər" });
      if (room.playerCount < 2) return socket.emit("error", { message: "Ən az 2 oyunçu lazımdır" });

      // Host hariç hazır olmayanları bul
      const notReady = room.getPlayerList().filter(p => !p.isHost && !p.isReady);
      if (notReady.length > 0) {
        const names = notReady.map(p => p.name).join(", ");
        // Chat'e bildir
        this.io.to(room.code).emit("chat:system", {
          message: `${names} hazır deyil — oyun başlamadı`,
          type:    "system",
        });
        return socket.emit("error", { message: `${notReady.length} oyunçu hazır deyil` });
      }

      // State sıfırla (yeniden oynamak için)
      if (room.state === ROOM_STATE.FINISHED) {
        room.setState(ROOM_STATE.WAITING);
        room.round = 0;
        room.getPlayerList().forEach(p => { p.score = 0; p.isReady = false; });
        room.activePlayers = Array.from(room.players.keys());
      }

      this.gameService.startCountdown(room);
    });

    // Solo antrenman başlat (tek oyuncu)
    socket.on("room:solo", ({ code }) => {
      const room = roomService.findRoom(code);
      if (!room) return;
      const player = room.getPlayer(socket.id);
      if (!player?.isHost) return;

      // State sıfırla
      if (room.state === ROOM_STATE.FINISHED) {
        room.setState(ROOM_STATE.WAITING);
        room.round = 0;
        room.getPlayerList().forEach(p => { p.score = 0; });
        room.activePlayers = Array.from(room.players.keys());
      }

      this.gameService.startCountdown(room);
    });
  }

  // ─── Game ──────────────────────────────────────────────────────

  _registerGameEvents(socket) {

    socket.on("game:stop", ({ code, stoppedAt }) => {
      const room = roomService.findRoom(code);
      if (!room) return;
      const player = room.getPlayer(socket.id);
      if (!player) return;
      this.gameService.playerStop(room, player, stoppedAt);
    });

    socket.on("game:next_round", ({ code }) => {
      const room = roomService.findRoom(code);
      if (!room || room.state !== ROOM_STATE.RESULT) return;
      // Sadece host ileri geçebilir
      const player = room.getPlayer(socket.id);
      if (!player?.isHost) return;
      this.gameService.startCountdown(room);
    });
  }

  // ─── Chat ──────────────────────────────────────────────────────

  _registerChatEvents(socket) {
    socket.on("chat:send", ({ code, message }) => {
      if (!message?.trim()) return;
      const room = roomService.findRoom(code);
      if (!room) return;
      const player = room.getPlayer(socket.id);
      if (!player) return;
      this.gameService.broadcastChat(room, player.name, message.trim());
    });
  }

  // ─── Disconnect ────────────────────────────────────────────────

  _registerDisconnect(socket) {
    socket.on("disconnect", (reason) => {
      console.log(`[Socket] Ayrıldı: ${socket.id} | Sebep: ${reason}`);

      const { room, player } = roomService.leaveRoom(socket.id);
      if (!room || !player) return;

      const inGame = [ROOM_STATE.PLAYING, ROOM_STATE.COUNTDOWN, ROOM_STATE.RESULT].includes(room.state);

      if (!room.isEmpty) {
        // Chat'e sistem mesajı
        this.io.to(room.code).emit("chat:system", {
          message: `${player.name} oyundan ayrıldı`,
          type:    "leave",
        });

        if (inGame) {
          // 1 kişi kaldıysa son kalan kazanır
          if (room.playerCount === 1) {
            const last = room.getPlayerList()[0];
            this.io.to(room.code).emit("game:last_standing", {
              name:   last.name,
              reason: `${player.name} oyundan ayrıldı`,
            });
          } else {
            // Oyun devam edemez — iptal
            this.gameService.abortGame(room, player.name);
          }
        } else {
          // Bekleme ekranında ayrıldı — sadece listeyi güncelle
          this.io.to(room.code).emit("room:player_left", {
            name: player.name,
            room: room.toPublic(),
          });
        }
      }
    });
  }
}

module.exports = SocketHandler;

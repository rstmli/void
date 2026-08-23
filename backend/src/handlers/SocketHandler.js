const roomService    = require("../services/RoomService");
const { ROOM_STATE } = require("../models/Room");
const { GAME }       = require("../config/ServerConfig");

class SocketHandler {
  constructor(io, gameService) {
    this.io          = io;
    this.gameService = gameService;
  }

  register(socket) {
    this._registerRoomEvents(socket);
    this._registerGameEvents(socket);
    this._registerChatEvents(socket);
    this._registerDisconnect(socket);
  }

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

    socket.on("room:ready", () => {
      const room = roomService.findRoomBySocket(socket.id);
      if (!room) return;
      roomService.toggleReady(socket.id);
      this.io.to(room.code).emit("room:updated", { room: room.toPublic() });
    });

    socket.on("player:color", ({ color }) => {
      const result = roomService.updatePlayerColor(socket.id, color);
      if (!result.success) return socket.emit("error", { message: result.error });
      this.io.to(result.room.code).emit("room:updated", { room: result.room.toPublic() });
    });

    socket.on("room:settings", (settings) => {
      const result = roomService.updateSettings(socket.id, settings);
      if (!result.success) return socket.emit("error", { message: result.error });
      this.io.to(result.room.code).emit("room:updated", { room: result.room.toPublic() });
    });

    socket.on("room:start", ({ code }) => {
      const room = roomService.findRoom(code);
      if (!room) return socket.emit("error", { message: "Oda tapılmadı" });

      if (![ROOM_STATE.WAITING, ROOM_STATE.FINISHED].includes(room.state))
        return socket.emit("error", { message: "Oyun artıq başlayıb" });

      const player = room.getPlayer(socket.id);
      if (!player?.isHost) return socket.emit("error", { message: "Yalnız host başlada bilər" });

      const minPlayers = room.gameMode === GAME.MODE_ELIMINATION ? 2 : 2;
      if (room.playerCount < minPlayers)
        return socket.emit("error", { message: `Ən az ${minPlayers} oyunçu lazımdır` });

      const notReady = room.getPlayerList().filter(p => !p.isHost && !p.isReady && !p.hasLeft);
      if (notReady.length > 0) {
        const names = notReady.map(p => p.name).join(", ");
        this.io.to(room.code).emit("chat:system", {
          message: `${names} hazır deyil — oyun başlamadı`,
          type:    "system",
        });
        return socket.emit("error", { message: `${notReady.length} oyunçu hazır deyil` });
      }

      // Yeniden başlatma reset — ayrılanları temizle
      if (room.state === ROOM_STATE.FINISHED) {
        // Ayrılanları odadan tamamen çıkar
        const leftPlayers = room.getPlayerList().filter(p => p.hasLeft);
        leftPlayers.forEach(p => room.removePlayer(p.socketId));
        
        room.setState(ROOM_STATE.WAITING);
        room.round = 0;
        room.getPlayerList().forEach(p => {
          p.score        = 0;
          p.isReady      = false;
          p.isEliminated = false;
          p.elimRound    = null;
          p.hasLeft      = false;
        });
        room.activePlayers = Array.from(room.players.keys());
      }

      this.gameService.startCountdown(room);
    });

    socket.on("room:solo", ({ code }) => {
      const room = roomService.findRoom(code);
      if (!room) return;
      const player = room.getPlayer(socket.id);
      if (!player?.isHost) return;
      if (room.state === ROOM_STATE.FINISHED) {
        // Ayrılanları temizle
        const leftPlayers = room.getPlayerList().filter(p => p.hasLeft);
        leftPlayers.forEach(p => room.removePlayer(p.socketId));
        
        room.setState(ROOM_STATE.WAITING);
        room.round = 0;
        room.getPlayerList().forEach(p => { 
          p.score = 0; 
          p.isEliminated = false; 
          p.elimRound = null;
          p.hasLeft = false;
        });
        room.activePlayers = Array.from(room.players.keys());
      }
      this.gameService.startCountdown(room);
    });
  }

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
      const player = room.getPlayer(socket.id);
      if (!player?.isHost) return;
      this.gameService.startCountdown(room);
    });
  }

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

  _registerDisconnect(socket) {
    socket.on("disconnect", () => {
      const room = roomService.findRoomBySocket(socket.id);
      if (!room) return;
      
      const player = room.getPlayer(socket.id);
      if (!player) return;

      const inGame = [ROOM_STATE.PLAYING, ROOM_STATE.COUNTDOWN, ROOM_STATE.RESULT].includes(room.state);

      if (inGame) {
        // Oyun sırasında ayrıldı — oyuncuyu işaretle, odadan çıkarma
        player.hasLeft = true;
        player.connected = false;
        
        this.io.to(room.code).emit("chat:system", {
          message: `${player.name} odadan ayrıldı`,
          type:    "leave",
        });

        // Oyuncu listesini güncelle
        this.io.to(room.code).emit("room:player_left", {
          name: player.name,
          room: room.toPublic(),
        });

        // Aktif oyunculardan çıkar (eğer aktifse)
        if (room.activePlayers.includes(socket.id)) {
          room.activePlayers = room.activePlayers.filter(id => id !== socket.id);
          player.isEliminated = true;
        }

        // Eğer sadece 1 aktif oyuncu kaldıysa
        if (room.activeCount === 1 && room.state === ROOM_STATE.PLAYING) {
          const last = room.getActivePlayerList()[0];
          if (last && !last.hasLeft) {
            this.io.to(room.code).emit("game:last_standing", {
              name:   last.name,
              reason: `${player.name} oyundan ayrıldı`,
            });
          }
        }
      } else {
        // Oyun dışında — odadan tamamen çıkar
        const { room: updatedRoom } = roomService.leaveRoom(socket.id);
        if (updatedRoom && !updatedRoom.isEmpty) {
          this.io.to(updatedRoom.code).emit("chat:system", {
            message: `${player.name} odadan ayrıldı`,
            type:    "leave",
          });
          this.io.to(updatedRoom.code).emit("room:player_left", {
            name: player.name,
            room: updatedRoom.toPublic(),
          });
        }
      }
    });
  }
}

module.exports = SocketHandler;

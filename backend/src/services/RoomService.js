const { Room, ROOM_STATE } = require("../models/Room");
const Player               = require("../models/Player");
const generateCode         = require("../utils/generateCode");
const { GAME }             = require("../config/ServerConfig");

class RoomService {
  constructor() {
    this._rooms = new Map();
  }

  createRoom() {
    let code;
    do { code = generateCode(); } while (this._rooms.has(code));
    const room = new Room(code);
    this._rooms.set(code, room);
    console.log(`[Room] Oluşturuldu: ${code}`);
    return room;
  }

  findRoom(code)   { return this._rooms.get(code); }
  deleteRoom(code) { this._rooms.delete(code); console.log(`[Room] Silindi: ${code}`); }

  joinRoom(socketId, name, roomCode) {
    const room = this.findRoom(roomCode);
    if (!room)                               return { success: false, error: "Oda tapılmadı" };
    if (room.isFull)                         return { success: false, error: "Oda dolu" };
    if (room.state !== ROOM_STATE.WAITING)   return { success: false, error: "Oyun başlamış" };

    const player = new Player(socketId, name);
    room.addPlayer(player);
    console.log(`[Room] ${name} → ${roomCode}`);
    return { success: true, player, room };
  }

  findRoomBySocket(socketId) {
    for (const room of this._rooms.values()) {
      if (room.getPlayer(socketId)) return room;
    }
    return undefined;
  }

  leaveRoom(socketId) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return {};
    const player = room.getPlayer(socketId);
    room.removePlayer(socketId);
    console.log(`[Room] ${player?.name} ayrıldı: ${room.code}`);
    if (room.isEmpty) this.deleteRoom(room.code);
    return { room, player };
  }

  /**
   * Oyuncu hazır durumunu değiştir.
   * @returns {boolean} güncel isReady değeri
   */
  toggleReady(socketId) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return false;
    const player = room.getPlayer(socketId);
    if (!player) return false;
    player.isReady = !player.isReady;
    return player.isReady;
  }

  /**
   * Oda ayarlarını güncelle (sadece host yapabilir).
   * @param {string} socketId — host'un socket'i
   * @param {object} settings — { winScore }
   */
  updateSettings(socketId, settings) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return { success: false, error: "Oda tapılmadı" };
    const player = room.getPlayer(socketId);
    if (!player?.isHost) return { success: false, error: "Yalnız host dəyişə bilər" };

    if (settings.winScore !== undefined) {
      const ws = parseInt(settings.winScore);
      if (ws >= GAME.MIN_WIN_SCORE && ws <= GAME.MAX_WIN_SCORE) {
        room.winScore = ws;
      }
    }

    return { success: true, room };
  }

  get activeRoomCount() { return this._rooms.size; }
}

module.exports = new RoomService();

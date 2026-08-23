const { Room, ROOM_STATE } = require("../models/Room");
const Player               = require("../models/Player");
const generateCode         = require("../utils/generateCode");
const { GAME }             = require("../config/ServerConfig");

function sanitizeName(name) {
  // Yalnız a-z, A-Z, 0-9, Azərbaycan hərfləri, space, - və _
  return String(name).replace(/[^a-zA-Z0-9əşıöüçğƏŞİÖÜÇĞ\s\-_]/g, '').trim();
}

function validateName(name) {
  const sanitized = sanitizeName(name);
  if (!sanitized) return { valid: false, error: "Ad yalnız hərf və rəqəmlərdən ibarət ola bilər" };
  if (sanitized.length < 2) return { valid: false, error: "Ad ən az 2 simvol olmalıdır" };
  if (sanitized.length > 16) return { valid: false, error: "Ad maksimum 16 simvol ola bilər" };
  return { valid: true, name: sanitized };
}

function sanitizeMessage(msg) {
  // XSS və injection qarşı müdafiə
  return String(msg)
    .replace(/[<>'"\/\\]/g, '') // HTML və script təhlükəsi
    .trim()
    .slice(0, 200); // Maksimum 200 simvol
}

class RoomService {
  constructor() { this._rooms = new Map(); }

  createRoom() {
    let code;
    do { code = generateCode(); } while (this._rooms.has(code));
    const room = new Room(code);
    this._rooms.set(code, room);
    return room;
  }

  findRoom(code)   { return this._rooms.get(code); }
  deleteRoom(code) { this._rooms.delete(code); }

  joinRoom(socketId, name, roomCode) {
    // Name validation
    const nameValidation = validateName(name);
    if (!nameValidation.valid) return { success: false, error: nameValidation.error };
    const sanitizedName = nameValidation.name;
    
    const room = this.findRoom(roomCode);
    if (!room)     return { success: false, error: "Oda tapılmadı" };
    if (room.isFull) return { success: false, error: "Oda dolu" };
    
    // WAITING veya FINISHED durumunda katılabilir
    if (![ROOM_STATE.WAITING, ROOM_STATE.FINISHED].includes(room.state)) {
      return { success: false, error: "Oyun davam edir" };
    }

    // Nickname unique kontrolü (sadece aktif oyuncular)
    const taken = room.getPlayerList()
      .filter(p => !p.hasLeft)
      .some(p => p.name.toLowerCase() === sanitizedName.toLowerCase());
    if (taken) return { success: false, error: `"${sanitizedName}" adı artıq istifadə olunur` };

    const player = new Player(socketId, sanitizedName);
    const added = room.addPlayer(player);
    if (!added) return { success: false, error: "Oda doldu" };
    
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
    if (room.isEmpty) this.deleteRoom(room.code);
    return { room, player };
  }

  toggleReady(socketId) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return false;
    const player = room.getPlayer(socketId);
    if (!player) return false;
    player.isReady = !player.isReady;
    return player.isReady;
  }

  updateSettings(socketId, settings) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return { success: false, error: "Oda tapılmadı" };
    const player = room.getPlayer(socketId);
    if (!player?.isHost) return { success: false, error: "Yalnız host dəyişə bilər" };

    if (settings.winScore !== undefined) {
      const ws = parseInt(settings.winScore);
      if (ws >= GAME.MIN_WIN_SCORE && ws <= GAME.MAX_WIN_SCORE) room.winScore = ws;
    }

    if (settings.gameMode !== undefined) {
      if ([GAME.MODE_CLASSIC, GAME.MODE_ELIMINATION].includes(settings.gameMode)) {
        if (settings.gameMode === GAME.MODE_CLASSIC && room.playerCount > GAME.MAX_PLAYERS_CLASSIC) {
          return { success: false, error: `Klassik mod üçün maksimum ${GAME.MAX_PLAYERS_CLASSIC} oyunçu lazımdır` };
        }
        room.gameMode = settings.gameMode;
      }
    }

    return { success: true, room };
  }

  /** Oyuncunun kendi rengini değiştir */
  updatePlayerColor(socketId, color) {
    const room = this.findRoomBySocket(socketId);
    if (!room) return { success: false, error: "Oda tapılmadı" };
    const player = room.getPlayer(socketId);
    if (!player) return { success: false, error: "Oyunçu tapılmadı" };

    // Renk başka biri tarafından kullanılıyor mu?
    const taken = room.getPlayerList().some(p => p.socketId !== socketId && p.color === color);
    if (taken) return { success: false, error: "Bu rəng artıq istifadə olunur" };

    player.color = color;
    return { success: true, room };
  }

  get activeRoomCount() { return this._rooms.size; }
}

module.exports = new RoomService();
module.exports.sanitizeMessage = sanitizeMessage;

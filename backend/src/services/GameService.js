const { ROOM_STATE } = require("../models/Room");
const { GAME }       = require("../config/ServerConfig");

class GameService {
  constructor(io) {
    this.io               = io;
    this._countdownTimers = new Map();
    this._afkTimers       = new Map();
    this._nextRoundTimers = new Map(); // auto next round timer
  }

  startCountdown(room) {
    this._clearTimer(room.code);
    room.setState(ROOM_STATE.COUNTDOWN);

    let count = GAME.COUNTDOWN_SECONDS;
    this._emit(room.code, "game:countdown", { count });

    const id = setInterval(() => {
      count--;
      if (count > 0) {
        this._emit(room.code, "game:countdown", { count });
      } else {
        clearInterval(id);
        this._countdownTimers.delete(room.code);
        this._startRound(room);
      }
    }, 1000);

    this._countdownTimers.set(room.code, id);
  }

  _startRound(room) {
    room.prepareRound();
    room.setState(ROOM_STATE.PLAYING);

    this._emit(room.code, "game:round_start", {
      round:    room.round,
      target:   room.target,
      players:  room.getPlayerList().map(p => p.toPublic()),
      active:   room.activePlayers,
      winScore: room.winScore,
      gameMode: room.gameMode,
    });

    console.log(`[Game][${room.gameMode}] Tur ${room.round} | Hedef: ${room.target}s | Aktif: ${room.activeCount} | ${room.code}`);

    // AFK guard
    const afkDeadline = (room.target + 10) * 1000;
    const afkTimer = setTimeout(() => {
      if (room.state !== ROOM_STATE.PLAYING) return;
      const afkPlayers = room.getActivePlayerList().filter(p => !p.hasStopped);
      if (!afkPlayers.length) return;

      console.log(`[Game] AFK: ${afkPlayers.map(p=>p.name).join(", ")}`);
      this._emit(room.code, "game:afk_disqualified", { names: afkPlayers.map(p=>p.name) });

      const remaining = room.getActivePlayerList().filter(p => p.hasStopped);
      if (remaining.length >= 1) {
        remaining.sort((a, b) => a.currentDiff - b.currentDiff);
        const winner = remaining[0];
        if (room.gameMode === GAME.MODE_CLASSIC) winner.addPoints(1);
        // Afk oyuncuları elime modunda elim et
        if (room.gameMode === GAME.MODE_ELIMINATION) {
          afkPlayers.forEach(p => { room.eliminatePlayer(p.socketId); p.elimRound = room.round; });
        }
        const champion = room.getChampion();
        if (champion) setTimeout(() => this._endGame(room, champion), 800);
        else this._endRound(room);
      } else {
        afkPlayers.forEach(p => p.stop(room.target + 10, room.target, GAME.PERFECT_THRESHOLD));
        this._endRound(room);
      }
    }, afkDeadline);

    this._afkTimers.set(room.code, afkTimer);
  }

  playerStop(room, player, stoppedAt) {
    if (room.state !== ROOM_STATE.PLAYING) return;
    if (player.hasStopped) return;

    player.stop(stoppedAt, room.target, GAME.PERFECT_THRESHOLD);
    this._emit(room.code, "game:player_stopped", { name: player.name });
    console.log(`[Game] ${player.name} durdu: ${stoppedAt.toFixed(3)}s | fark: ${player.currentDiff.toFixed(3)}s`);

    if (room.allActiveStopped()) this._endRound(room);
  }

  _endRound(room) {
    // AFK timer temizle
    const afk = this._afkTimers.get(room.code);
    if (afk) { clearTimeout(afk); this._afkTimers.delete(room.code); }

    room.setState(ROOM_STATE.RESULT);

    const active  = room.getActivePlayerList().filter(p => !p.hasLeft); // ayrılanları sayma
    const winner  = room.getRoundWinner();
    const tied    = winner === null;

    let eliminated = null;

    if (room.gameMode === GAME.MODE_CLASSIC) {
      // Classic: puan ver, elimination yok (ama ayrılanlara puan verme)
      if (!tied && winner && !winner.hasLeft) {
        const pts = winner.isPerfect ? 2 : 1;
        winner.addPoints(pts);
      }
    } else {
      // Elimination: puan yok, en kötü elenir (ama ayrılanlar hariç)
      if (!tied) {
        const worst = room.getWorstPlayer();
        if (worst && active.length > 1 && !worst.hasLeft) {
          worst.elimRound = room.round;
          room.eliminatePlayer(worst.socketId);
          eliminated = worst.name;
          console.log(`[Game] ${worst.name} elendi (tur ${room.round})`);
        }
      }
    }

    const results = active.map(p => p.toRoundResult()).sort((a, b) => a.diff - b.diff);
    
    // Şampiyon kontrolü
    const champion = room.getChampion();
    const isGameOver = champion && !champion.hasLeft;

    this._emit(room.code, "game:round_result", {
      round:      room.round,
      target:     room.target,
      tied,
      winner:     winner?.name ?? null,
      isPerfect:  winner?.isPerfect ?? false,
      eliminated,
      results,
      scores:     room.getPlayerList().map(p => p.toPublic()),
      remaining:  room.activePlayers,
      gameMode:   room.gameMode,
      isGameOver, // oyun bitti mi
      champion:   isGameOver ? champion.name : null,
    });

    if (isGameOver) {
      // Oyun bitti — ama direkt dönme, kullanıcı karar versin
      // 7-9 saniye sonra auto lobby
      const autoDelay = 7000 + Math.random() * 2000;
      const autoTimer = setTimeout(() => {
        if (room.state === ROOM_STATE.RESULT) {
          console.log(`[Game] Auto return to lobby | ${room.code}`);
          room.setState(ROOM_STATE.WAITING);
          // Reset game state
          room.round = 0;
          room.getPlayerList().forEach(p => {
            p.score = 0;
            p.isReady = false;
            p.isEliminated = false;
            p.elimRound = null;
            p.hasLeft = false;
            p.readyForNext = false;
          });
          room.activePlayers = Array.from(room.players.keys()).filter(id => {
            const p = room.players.get(id);
            return p && !p.hasLeft;
          });
          this._emit(room.code, "game:return_to_lobby");
        }
      }, autoDelay);
      this._nextRoundTimers.set(room.code, autoTimer);
      return;
    }

    if (room.activeCount === 1) {
      const last = room.getActivePlayerList()[0];
      if (last && !last.hasLeft) {
        const autoDelay = 7000 + Math.random() * 2000;
        setTimeout(() => {
          room.setState(ROOM_STATE.WAITING);
          this._emit(room.code, "game:return_to_lobby");
        }, autoDelay);
      }
      return;
    }

    // Auto next round timer (7-9 saniye)
    const autoDelay = 7000 + Math.random() * 2000;
    const autoTimer = setTimeout(() => {
      if (room.state === ROOM_STATE.RESULT) {
        console.log(`[Game] Auto next round | ${room.code}`);
        this.startCountdown(room);
      }
    }, autoDelay);
    
    this._nextRoundTimers.set(room.code, autoTimer);
  }

  /** Oyuncu next-e hazır oldu */
  playerReadyForNext(room, player) {
    if (room.state !== ROOM_STATE.RESULT) return;
    if (player.isEliminated || player.hasLeft) return;
    
    player.readyForNext = true;
    
    // Tüm aktif oyuncular ready mi?
    const active = room.getActivePlayerList().filter(p => !p.hasLeft);
    const allReady = active.every(p => p.readyForNext);
    
    // Update gönder
    this._emit(room.code, "game:next_ready_update", {
      players: room.getPlayerList().map(p => p.toPublic()),
    });
    
    if (allReady) {
      // Timer'ı iptal et, direkt başlat
      const timer = this._nextRoundTimers.get(room.code);
      if (timer) {
        clearTimeout(timer);
        this._nextRoundTimers.delete(room.code);
      }
      console.log(`[Game] Tüm oyuncular hazır, next round | ${room.code}`);
      this.startCountdown(room);
    }
  }

  _endGame(room, champion) {
    room.setState(ROOM_STATE.FINISHED);

    let finalScores;
    if (room.gameMode === GAME.MODE_ELIMINATION) {
      // Elimination: eleniş sırasına göre sırala (son elenen = ikinci)
      finalScores = room.getPlayerList()
        .map(p => p.toPublic())
        .sort((a, b) => {
          // Kazanan en üstte
          if (a.name === champion.name) return -1;
          if (b.name === champion.name) return 1;
          // Elimround büyük olan daha geç elendi = daha iyi
          return (b.elimRound ?? 0) - (a.elimRound ?? 0);
        });
    } else {
      finalScores = room.getPlayerList()
        .map(p => p.toPublic())
        .sort((a, b) => b.score - a.score);
    }

    this._emit(room.code, "game:finished", {
      champion:    champion.name,
      finalScores,
      gameMode:    room.gameMode,
    });

    console.log(`[Game] Bitti | ${champion.name} | ${room.gameMode} | ${room.code}`);
  }

  /** Oyuncu lobby-ə döndü işareti */
  playerReturnedToLobby(room, player) {
    if (!player) return;
    
    // Timer'ı iptal et
    const timer = this._nextRoundTimers.get(room.code);
    if (timer) {
      clearTimeout(timer);
      this._nextRoundTimers.delete(room.code);
    }
    
    // Game state reset
    room.setState(ROOM_STATE.WAITING);
    room.round = 0;
    room.getPlayerList().forEach(p => {
      p.score = 0;
      p.isReady = false;
      p.isEliminated = false;
      p.elimRound = null;
      p.readyForNext = false;
    });
    room.activePlayers = Array.from(room.players.keys()).filter(id => {
      const p = room.players.get(id);
      return p && !p.hasLeft;
    });
    
    // Herkese bildir + room data gönder
    this._emit(room.code, "game:return_to_lobby");
    this._emit(room.code, "room:updated", { room: room.toPublic() });
  }

  abortGame(room, playerName) {
    this._clearTimer(room.code);
    room.setState(ROOM_STATE.WAITING);
    this._emit(room.code, "game:aborted", { reason: `${playerName} oyundan ayrıldı`, playerName });
  }

  broadcastChat(room, senderName, message) {
    this._emit(room.code, "chat:message", {
      name:      senderName,
      message:   message.slice(0, 200),
      timestamp: Date.now(),
    });
  }

  _clearTimer(roomCode) {
    const id = this._countdownTimers.get(roomCode);
    if (id) { clearInterval(id); this._countdownTimers.delete(roomCode); }
    
    const nextTimer = this._nextRoundTimers.get(roomCode);
    if (nextTimer) { clearTimeout(nextTimer); this._nextRoundTimers.delete(roomCode); }
  }

  _emit(roomCode, event, data) {
    this.io.to(roomCode).emit(event, data);
  }
}

module.exports = GameService;

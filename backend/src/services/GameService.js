const { ROOM_STATE } = require("../models/Room");
const { GAME }       = require("../config/ServerConfig");

class GameService {
  constructor(io) {
    this.io               = io;
    this._countdownTimers = new Map();
    this._afkTimers       = new Map();
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

    const active  = room.getActivePlayerList();
    const winner  = room.getRoundWinner();
    const tied    = winner === null;

    let eliminated = null;

    if (room.gameMode === GAME.MODE_CLASSIC) {
      // Classic: puan ver, elimination yok
      if (!tied && winner) {
        const pts = winner.isPerfect ? 2 : 1;
        winner.addPoints(pts);
      }
    } else {
      // Elimination: puan yok, en kötü elenir
      if (!tied) {
        const worst = room.getWorstPlayer();
        if (worst && active.length > 1) {
          worst.elimRound = room.round;
          room.eliminatePlayer(worst.socketId);
          eliminated = worst.name;
          console.log(`[Game] ${worst.name} elendi (tur ${room.round})`);
        }
      }
      // Beraberlikte kimse elenmiyor
    }

    const results = active.map(p => p.toRoundResult()).sort((a, b) => a.diff - b.diff);

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
    });

    const champion = room.getChampion();
    if (champion) {
      setTimeout(() => this._endGame(room, champion), GAME.RESULT_DELAY_MS);
      return;
    }

    if (room.activeCount === 1) {
      const last = room.getActivePlayerList()[0];
      setTimeout(() => this._endGame(room, last), GAME.RESULT_DELAY_MS);
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
  }

  _emit(roomCode, event, data) {
    this.io.to(roomCode).emit(event, data);
  }
}

module.exports = GameService;

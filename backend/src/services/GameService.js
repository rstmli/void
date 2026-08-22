const { ROOM_STATE } = require("../models/Room");
const { GAME }       = require("../config/ServerConfig");

class GameService {
  constructor(io) {
    this.io                = io;
    this._countdownTimers  = new Map();
  }

  // ─── Countdown ─────────────────────────────────────────────────

  startCountdown(room) {
    // Önceki timer varsa temizle
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

  // ─── Round start ───────────────────────────────────────────────

  _startRound(room) {
    room.prepareRound();
    room.setState(ROOM_STATE.PLAYING);

    this._emit(room.code, "game:round_start", {
      round:    room.round,
      target:   room.target,
      players:  room.getPlayerList().map(p => p.toPublic()),
      active:   room.activePlayers,
      winScore: room.winScore,
    });

    console.log(`[Game] Tur ${room.round} | Hedef: ${room.target}s | ${room.code}`);

    // AFK guard: target + 10 saniye geçerse diskalifiye et ve oyunu bitir
    const afkDeadline = (room.target + 10) * 1000;
    const afkTimer = setTimeout(() => {
      if (room.state !== ROOM_STATE.PLAYING) return;

      const afkPlayers = room.getActivePlayerList().filter(p => !p.hasStopped);
      if (afkPlayers.length === 0) return;

      console.log(`[Game] AFK diskalifiye: ${afkPlayers.map(p=>p.name).join(", ")}`);

      // AFK oyuncuları bildir ve oyunu bitir
      this._emit(room.code, "game:afk_disqualified", {
        names: afkPlayers.map(p => p.name),
      });

      // Kalan aktif (stop basmış) oyuncu varsa o kazanır
      const remaining = room.getActivePlayerList().filter(p => p.hasStopped);
      if (remaining.length >= 1) {
        // En iyi skoru olan veya tek kalan kazanır
        remaining.sort((a, b) => a.currentDiff - b.currentDiff);
        const winner = remaining[0];
        winner.addPoints(1);
        setTimeout(() => this._endGame(room, winner), 800);
      } else {
        // Kimse basmamış — tur sonucu göster, kazanan yok
        afkPlayers.forEach(p => p.stop(room.target + 10, room.target, GAME.PERFECT_THRESHOLD));
        this._endRound(room);
      }
    }, afkDeadline);

    if (!this._afkTimers) this._afkTimers = new Map();
    this._afkTimers.set(room.code, afkTimer);
  }

  // ─── Player stop ───────────────────────────────────────────────

  playerStop(room, player, stoppedAt) {
    if (room.state !== ROOM_STATE.PLAYING) return;
    if (player.hasStopped) return;

    player.stop(stoppedAt, room.target, GAME.PERFECT_THRESHOLD);

    this._emit(room.code, "game:player_stopped", { name: player.name });

    console.log(`[Game] ${player.name} durdu: ${stoppedAt.toFixed(3)}s | fark: ${player.currentDiff.toFixed(3)}s`);

    if (room.allActiveStopped()) {
      this._endRound(room);
    }
  }

  // ─── Round end ─────────────────────────────────────────────────

  _endRound(room) {
    // AFK timer'ı temizle
    if (this._afkTimers?.has(room.code)) {
      clearTimeout(this._afkTimers.get(room.code));
      this._afkTimers.delete(room.code);
    }

    room.setState(ROOM_STATE.RESULT);

    const active  = room.getActivePlayerList();
    const winner  = room.getRoundWinner();
    const tied    = winner === null;

    // Puan ver
    if (!tied && winner) {
      const pts = winner.isPerfect ? 2 : 1;
      winner.addPoints(pts);
      console.log(`[Game] ${winner.name} +${pts} puan | perfect: ${winner.isPerfect}`);
    }

    // Elimination: 3+ aktif oyuncu varsa en kötüyü at
    let eliminated = null;
    if (active.length >= GAME.ELIMINATION_MIN_PLAYERS) {
      const worst = room.getWorstPlayer();
      if (worst) {
        room.eliminatePlayer(worst.socketId);
        eliminated = worst.name;
        console.log(`[Game] ${worst.name} elendi`);
      }
    }

    const results = active
      .map(p => p.toRoundResult())
      .sort((a, b) => a.diff - b.diff);

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
    });

    // Şampiyon kontrolü
    const champion = room.getChampion();
    if (champion) {
      setTimeout(() => this._endGame(room, champion), GAME.RESULT_DELAY_MS);
      return;
    }

    // 1 aktif kaldıysa o kazandı
    if (room.activeCount === 1) {
      const last = room.getActivePlayerList()[0];
      setTimeout(() => this._endGame(room, last), GAME.RESULT_DELAY_MS);
    }
  }

  // ─── Game end ──────────────────────────────────────────────────

  _endGame(room, champion) {
    room.setState(ROOM_STATE.FINISHED);

    const finalScores = room.getPlayerList()
      .map(p => p.toPublic())
      .sort((a, b) => b.score - a.score);

    this._emit(room.code, "game:finished", {
      champion:    champion.name,
      finalScores,
    });

    console.log(`[Game] Bitti | Şampiyon: ${champion.name} | ${room.code}`);
  }

  // ─── Abort ─────────────────────────────────────────────────────

  abortGame(room, playerName) {
    this._clearTimer(room.code);
    room.setState(ROOM_STATE.WAITING);
    this._emit(room.code, "game:aborted", {
      reason: `${playerName} oyundan ayrıldı`,
      playerName,
    });
  }

  // ─── Chat ──────────────────────────────────────────────────────

  /**
   * Chat mesajını odaya yayar.
   */
  broadcastChat(room, senderName, message) {
    this._emit(room.code, "chat:message", {
      name:      senderName,
      message:   message.slice(0, 200), // max 200 karakter
      timestamp: Date.now(),
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────

  _clearTimer(roomCode) {
    const id = this._countdownTimers.get(roomCode);
    if (id) { clearInterval(id); this._countdownTimers.delete(roomCode); }
  }

  _emit(roomCode, event, data) {
    this.io.to(roomCode).emit(event, data);
  }
}

module.exports = GameService;

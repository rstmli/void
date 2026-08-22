const { GAME } = require("../config/ServerConfig");

const ROOM_STATE = {
  WAITING:   "waiting",
  COUNTDOWN: "countdown",
  PLAYING:   "playing",
  RESULT:    "result",
  FINISHED:  "finished",
};

class Room {
  constructor(code) {
    this.code         = code;
    this.state        = ROOM_STATE.WAITING;
    this.players      = new Map();   // socketId → Player
    this.round        = 0;
    this.target       = 0;
    this.winScore     = GAME.DEFAULT_WIN_SCORE;  // oda ayarı
    // Elimination modu için — elenmemiş aktif oyuncular
    this.activePlayers = [];  // socketId listesi
  }

  // ─── Oyuncu ────────────────────────────────────────────────────

  addPlayer(player) {
    if (this.players.size >= GAME.MAX_PLAYERS) return false;
    if (this.state !== ROOM_STATE.WAITING)     return false;

    // İlk oyuncu host olur
    if (this.players.size === 0) player.isHost = true;

    this.players.set(player.socketId, player);
    this.activePlayers.push(player.socketId);
    return true;
  }

  removePlayer(socketId) {
    this.players.delete(socketId);
    this.activePlayers = this.activePlayers.filter(id => id !== socketId);

    // Host ayrıldıysa sıradaki oyuncuyu host yap
    const list = this.getPlayerList();
    if (list.length > 0 && !list.some(p => p.isHost)) {
      list[0].isHost = true;
    }
  }

  getPlayer(socketId)  { return this.players.get(socketId); }
  getPlayerList()      { return Array.from(this.players.values()); }
  getActivePlayerList(){ return this.activePlayers.map(id => this.players.get(id)).filter(Boolean); }
  getHost()            { return this.getPlayerList().find(p => p.isHost); }

  get playerCount()   { return this.players.size; }
  get activeCount()   { return this.activePlayers.length; }
  get isFull()        { return this.players.size >= GAME.MAX_PLAYERS; }
  get isEmpty()       { return this.players.size === 0; }
  get allReady()      { return this.getPlayerList().every(p => p.isReady); }

  // ─── Tur ───────────────────────────────────────────────────────

  prepareRound() {
    this.round += 1;
    this.target = parseFloat(
      (GAME.TARGET_MIN + Math.random() * (GAME.TARGET_MAX - GAME.TARGET_MIN)).toFixed(2)
    );
    // Sadece aktif oyuncuları sıfırla
    this.getActivePlayerList().forEach(p => p.resetForRound());
  }

  allActiveStopped() {
    return this.getActivePlayerList().every(p => p.hasStopped);
  }

  /**
   * Tur kazananı — aktif oyuncular arasından.
   * null = beraberlik
   */
  getRoundWinner() {
    const active = this.getActivePlayerList().sort((a, b) => a.currentDiff - b.currentDiff);
    if (!active.length) return null;
    const best = active[0].currentDiff;
    const tied = active.filter(p => Math.abs(p.currentDiff - best) < 0.001);
    return tied.length === 1 ? tied[0] : null;
  }

  /**
   * En kötü oyuncuyu döner (elimination için).
   * null = beraberlik son sırada
   */
  getWorstPlayer() {
    const active  = this.getActivePlayerList().sort((a, b) => b.currentDiff - a.currentDiff);
    if (!active.length) return null;
    const worst   = active[0].currentDiff;
    const tied    = active.filter(p => Math.abs(p.currentDiff - worst) < 0.001);
    return tied.length === 1 ? tied[0] : null;
  }

  eliminatePlayer(socketId) {
    this.activePlayers = this.activePlayers.filter(id => id !== socketId);
    const p = this.players.get(socketId);
    if (p) p.isEliminated = true;
  }

  getChampion() {
    return this.getPlayerList().find(p => p.score >= this.winScore) ?? null;
  }

  setState(s) { this.state = s; }

  toPublic() {
    return {
      code:      this.code,
      state:     this.state,
      round:     this.round,
      winScore:  this.winScore,
      players:   this.getPlayerList().map(p => p.toPublic()),
    };
  }
}

module.exports = { Room, ROOM_STATE };

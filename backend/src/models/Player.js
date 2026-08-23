class Player {
  constructor(socketId, name) {
    this.socketId     = socketId;
    this.name         = name;
    this.score        = 0;
    this.isReady      = false;
    this.isHost       = false;
    this.isEliminated = false;
    this.connected    = true;
    this.hasLeft      = false;  // odadan ayrıldı mı
    this.elimRound    = null;
    this.color        = null;   // hex renk — frontend tarafından atanır
    this.readyForNext = false;  // round result-da next tura hazır mı
    this.inLobby      = true;   // lobby-də mi, yoxsa result screen-də mi

    this.currentTime = 0;
    this.currentDiff = 0;
    this.hasStopped  = false;
    this.isPerfect   = false;
    
    // ANTI-CHEAT: Perfect spam detection
    this.perfectCount = 0;      // Arka arkaya perfect sayısı
    this.lastStopTime = 0;      // Son stop zamanı (spam detection)
  }

  addPoints(n = 1) { this.score += n; }

  stop(stoppedAt, target, perfectThreshold) {
    this.hasStopped  = true;
    this.currentTime = stoppedAt;
    this.currentDiff = Math.abs(stoppedAt - target);
    this.isPerfect   = this.currentDiff <= perfectThreshold;
    this.lastStopTime = Date.now();
    
    // ANTI-CHEAT: Perfect counter
    if (this.isPerfect) {
      this.perfectCount++;
    } else {
      this.perfectCount = 0; // Reset
    }
  }

  resetForRound() {
    this.currentTime  = 0;
    this.currentDiff  = 0;
    this.hasStopped   = false;
    this.isPerfect    = false;
    this.isEliminated = false;
    this.readyForNext = false;
  }

  toPublic() {
    return {
      name:         this.name,
      score:        this.score,
      isHost:       this.isHost,
      isReady:      this.isReady,
      connected:    this.connected,
      hasLeft:      this.hasLeft,
      isEliminated: this.isEliminated,
      elimRound:    this.elimRound,
      color:        this.color,
      readyForNext: this.readyForNext,
      inLobby:      this.inLobby,
    };
  }

  toRoundResult() {
    return {
      name:      this.name,
      time:      this.currentTime,
      diff:      this.currentDiff,
      isPerfect: this.isPerfect,
    };
  }
}

module.exports = Player;

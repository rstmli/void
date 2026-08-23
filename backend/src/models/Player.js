class Player {
  constructor(socketId, name) {
    this.socketId     = socketId;
    this.name         = name;
    this.score        = 0;
    this.isReady      = false;
    this.isHost       = false;
    this.isEliminated = false;
    this.connected    = true;
    this.elimRound    = null;
    this.color        = null;   // hex renk — frontend tarafından atanır

    this.currentTime = 0;
    this.currentDiff = 0;
    this.hasStopped  = false;
    this.isPerfect   = false;
  }

  addPoints(n = 1) { this.score += n; }

  stop(stoppedAt, target, perfectThreshold) {
    this.hasStopped  = true;
    this.currentTime = stoppedAt;
    this.currentDiff = Math.abs(stoppedAt - target);
    this.isPerfect   = this.currentDiff <= perfectThreshold;
  }

  resetForRound() {
    this.currentTime  = 0;
    this.currentDiff  = 0;
    this.hasStopped   = false;
    this.isPerfect    = false;
    this.isEliminated = false;
  }

  toPublic() {
    return {
      name:         this.name,
      score:        this.score,
      isHost:       this.isHost,
      isReady:      this.isReady,
      connected:    this.connected,
      isEliminated: this.isEliminated,
      elimRound:    this.elimRound,
      color:        this.color,
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

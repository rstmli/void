const ServerConfig = {
  PORT: process.env.PORT || 3001,

  CORS: {
    origin: "*",
    methods: ["GET", "POST"],
  },

  GAME: {
    MAX_PLAYERS: 4,
    // Win score artık oda ayarında — burası sadece default
    DEFAULT_WIN_SCORE: 3,
    MIN_WIN_SCORE: 3,
    MAX_WIN_SCORE: 10,
    TARGET_MIN: 2.0,
    TARGET_MAX: 9.99,
    COUNTDOWN_SECONDS: 3,
    RESULT_DELAY_MS: 1200,
    // Perfect eşiği — bu kadar fark "perfect" sayılır → +2 puan
    PERFECT_THRESHOLD: 0.05,
    // Elimination modu: 2+ oyuncuda en uzak oyuncu elenir
    ELIMINATION_MIN_PLAYERS: 3,
  },
};

module.exports = ServerConfig;

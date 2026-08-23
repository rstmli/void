const ServerConfig = {
  PORT: process.env.PORT || 3001,

  CORS: {
    origin: "*",
    methods: ["GET", "POST"],
  },

  GAME: {
    MAX_PLAYERS:       12,   // elimination modunda 12'ye kadar
    MAX_PLAYERS_CLASSIC: 4,  // classic modda 4
    DEFAULT_WIN_SCORE: 3,
    MIN_WIN_SCORE:     3,
    MAX_WIN_SCORE:     10,
    TARGET_MIN:        2.0,
    TARGET_MAX:        9.99,
    COUNTDOWN_SECONDS: 3,
    RESULT_DELAY_MS:   1200,
    PERFECT_THRESHOLD: 0.05,
    // Mod sabitleri
    MODE_CLASSIC:     "classic",
    MODE_ELIMINATION: "elimination",
  },
};

module.exports = ServerConfig;

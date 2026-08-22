# VOID — Backend

## Kurulum

```bash
cd backend
npm install
npm run dev      # geliştirme (nodemon — dosya değişince otomatik restart)
npm start        # production
```

Sunucu `http://localhost:3001` adresinde çalışır.

---

## Klasör yapısı

```
src/
  config/
    ServerConfig.js     ← tüm sabitler (port, max oyuncu, win score...)
  models/
    Player.js           ← oyuncu verisi ve metodları
    Room.js             ← oda verisi, durum, tur yönetimi
  services/
    RoomService.js      ← oda oluştur/bul/sil, oyuncu ekle/çıkar (singleton)
    GameService.js      ← geri sayım, tur akışı, puan, oyun sonu
  handlers/
    SocketHandler.js    ← client event'lerini dinle → servislere ilet
  utils/
    generateCode.js     ← rastgele oda kodu üretici
server.js               ← giriş noktası, parçaları birleştirir
```

---

## Socket Event'leri

### Client → Server (sen gönderirsin)

| Event | Data | Açıklama |
|---|---|---|
| `room:create` | `{ name }` | Yeni oda oluştur |
| `room:join` | `{ name, code }` | Var olan odaya katıl |
| `room:start` | `{ code }` | Oyunu başlat |
| `game:stop` | `{ code, stoppedAt }` | Durdur tuşuna bastı |
| `game:next_round` | `{ code }` | Sonraki tur |

### Server → Client (sunucu gönderir)

| Event | Data | Açıklama |
|---|---|---|
| `room:created` | `{ code, room }` | Oda oluşturuldu |
| `room:joined` | `{ room }` | Odaya katıldın |
| `room:player_joined` | `{ room }` | Başkası katıldı |
| `room:player_left` | `{ name, room }` | Biri ayrıldı |
| `game:countdown` | `{ count }` | Geri sayım tiki |
| `game:round_start` | `{ round, target, players }` | Tur başladı |
| `game:player_stopped` | `{ name }` | Biri durdurdu (zaman gizli) |
| `game:round_result` | `{ round, target, tied, winner, results, scores }` | Tur bitti |
| `game:finished` | `{ champion, finalScores }` | Oyun bitti |
| `game:aborted` | `{ reason }` | Oyun iptal |
| `error` | `{ message }` | Hata mesajı |

---

## SOLID prensipleri nerede?

- **S** — Her sınıfın tek bir sorumluluğu var. `RoomService` oda yönetir, `GameService` oyun akışını yönetir, `SocketHandler` sadece event routing yapar.
- **O** — Yeni event eklemek için mevcut handler'ı bozmadan yeni `_registerX()` metodu eklersin.
- **L** — Kullanılmıyor (inheritance yok) ama ihlal da edilmiyor.
- **I** — Her servisin arayüzü küçük ve net. `GameService` sadece oyun metodlarını açar.
- **D** — `GameService` ve `SocketHandler` doğrudan `Room` yaratmaz, `RoomService`'e bağımlıdır.

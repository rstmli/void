/**
 * generateCode — Rastgele oda kodu üretir.
 *
 * SOLID: Single Responsibility — sadece kod üretir, başka bir işi yok.
 *
 * @returns {string}  örn. "VOID-4F2A"
 */
function generateCode() {
  // Math.random() → 0-1 arası float
  // .toString(16)  → hex string'e çevirir (örn. "0.a3f2...")
  // .slice(2,6)    → ilk 4 karakteri alır
  // .toUpperCase() → büyük harfe çevirir
  const hex = Math.random().toString(16).slice(2, 6).toUpperCase();
  return `VOID-${hex}`;
}

module.exports = generateCode;

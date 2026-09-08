export function createHUD() {
  const kmh = document.getElementById('kmh');
  const street = document.getElementById('street');
  const place = document.getElementById('place');
  const fareEl = document.getElementById('fare');
  const flashEl = document.getElementById('flash');
  const moneyEl = document.getElementById('money');
  let lastStreet = null, t = 0, lastKmh = -1, lastPlace = '', lastFare = '', lastFlash = '', lastMoney = '';
  return {
    update(speedKmh, streetName, placeName, dt) {
      const k = Math.round(Math.abs(speedKmh));
      if (k !== lastKmh) { kmh.textContent = k; lastKmh = k; }
      t += dt;
      if (streetName && streetName !== lastStreet && t > 0.4) { street.textContent = streetName; lastStreet = streetName; t = 0; }
      if (placeName && placeName !== lastPlace) { place.textContent = placeName.toUpperCase(); lastPlace = placeName; }
    },
    fare(text, phase) { if (text === lastFare && fareEl.dataset.phase === phase) return; lastFare = text; fareEl.textContent = text; fareEl.dataset.phase = phase; fareEl.style.display = text ? 'block' : 'none'; },
    flash(text) { if (text === lastFlash) return; lastFlash = text; flashEl.textContent = text; flashEl.style.display = text ? 'block' : 'none'; },
    money(v, n) { const t = v.toFixed(2) + ' KM' + (n ? ` · ${n} ${n === 1 ? 'vožnja' : n < 5 ? 'vožnje' : 'vožnji'}` : ''); if (t !== lastMoney) { lastMoney = t; moneyEl.textContent = t; } },
  };
}

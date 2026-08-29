export function createHUD() {
  const kmh = document.getElementById('kmh');
  const street = document.getElementById('street');
  const place = document.getElementById('place');
  const fareEl = document.getElementById('fare');
  const flashEl = document.getElementById('flash');
  const moneyEl = document.getElementById('money');
  let lastStreet = null, t = 0;
  return {
    update(speedKmh, streetName, placeName, dt) {
      kmh.textContent = Math.round(Math.abs(speedKmh));
      t += dt;
      if (streetName && streetName !== lastStreet && t > 0.4) { street.textContent = streetName; lastStreet = streetName; t = 0; }
      if (placeName) place.textContent = placeName.toUpperCase();
    },
    fare(text, phase) { fareEl.textContent = text; fareEl.dataset.phase = phase; fareEl.style.display = text ? 'block' : 'none'; },
    flash(text) { flashEl.textContent = text; flashEl.style.display = text ? 'block' : 'none'; },
    money(v, n) { moneyEl.textContent = v.toFixed(2) + ' KM' + (n ? ` · ${n} ${n === 1 ? 'vožnja' : n < 5 ? 'vožnje' : 'vožnji'}` : ''); },
  };
}

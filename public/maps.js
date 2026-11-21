// Google Maps Platform for Fair Whack (FW2.0).
// The key is meant to be public: Google limits it to fair-whack.pages.dev and to three APIs
// (Maps JavaScript, Places (New), Routes). Change it in Google Cloud → APIs & Services → Credentials.
export const MAPS_KEY = 'AIzaSyBWIXYCMxjItfaN3fORkF50JGOOeCHkWLA';

// Victoria, roughly. Suggestions are kept inside this box.
const VIC = { south: -39.2, west: 140.9, north: -33.95, east: 150.05 };

let loading;
/** Loads the Maps JavaScript API once. Resolves to the places library, or null if it can't load (offline, blocked). */
export function loadPlaces() {
  if (!loading) {
    loading = new Promise((resolve) => {
      const done = async () => {
        try { resolve(await google.maps.importLibrary('places')); } catch { resolve(null); }
      };
      if (window.google?.maps?.importLibrary) return done();
      window.__fwMapsReady = done;
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}&v=weekly&loading=async&region=AU&language=en-AU&callback=__fwMapsReady`;
      s.async = true;
      s.onerror = () => { loading = null; resolve(null); };
      document.head.appendChild(s);
      setTimeout(() => resolve(null), 12000);
    });
  }
  return loading;
}

const comp = (place, type, short) => {
  const c = (place.addressComponents || []).find((x) => x.types.includes(type));
  return c ? (short ? c.shortText : c.longText) : '';
};

/** Splits a Place into the parts we store. */
export function placeParts(place) {
  const num = comp(place, 'street_number');
  const route = comp(place, 'route');
  const sub = comp(place, 'subpremise');
  const street = [num, route].filter(Boolean).join(' ');
  const line = street ? (sub ? `${sub}/${street}` : street) : (place.displayName || place.formattedAddress || '').split(',')[0];
  return {
    line,
    suburb: comp(place, 'locality') || comp(place, 'sublocality') || comp(place, 'postal_town'),
    postcode: comp(place, 'postal_code'),
    full: place.formattedAddress || '',
    lat: place.location ? Math.round(place.location.lat() * 1e6) / 1e6 : undefined,
    lng: place.location ? Math.round(place.location.lng() * 1e6) / 1e6 : undefined,
    placeId: place.id,
  };
}

/**
 * Adds address suggestions under a text input. Typing still works without Google (the box stays a plain input).
 * onPick(parts) is called with placeParts() of the chosen suggestion.
 */
export function attachAutocomplete(input, onPick) {
  if (!input || input.dataset.ac) return;
  input.dataset.ac = '1';
  input.setAttribute('autocomplete', 'off');
  const box = document.createElement('div');
  box.className = 'ac-list';
  box.hidden = true;
  box.setAttribute('role', 'listbox');
  input.insertAdjacentElement('afterend', box);
  let lib, token, timer, items = [], active = -1, seq = 0;
  const close = () => { box.hidden = true; box.innerHTML = ''; items = []; active = -1; };
  const show = (list) => {
    items = list;
    active = -1;
    if (!list.length) return close();
    box.innerHTML = list.map((s, i) => `<button type="button" role="option" data-i="${i}"><b>${esc(s.placePrediction.mainText?.toString() || s.placePrediction.text.toString())}</b><span>${esc(s.placePrediction.secondaryText?.toString() || '')}</span></button>`).join('')
      + '<div class="ac-by">Powered by Google</div>';
    box.hidden = false;
    box.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); pick(Number(b.dataset.i)); }));
  };
  const pick = async (i) => {
    const s = items[i];
    close();
    if (!s) return;
    input.value = s.placePrediction.text.toString();
    try {
      const place = s.placePrediction.toPlace();
      await place.fetchFields({ fields: ['addressComponents', 'formattedAddress', 'location', 'displayName'] });
      token = null; // a pick ends the billing session
      onPick(placeParts(place));
    } catch { /* keep what was typed */ }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 3) return close();
    timer = setTimeout(async () => {
      lib = lib || await loadPlaces();
      if (!lib) return;
      token = token || new lib.AutocompleteSessionToken();
      const my = ++seq;
      try {
        const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: q, sessionToken: token, includedRegionCodes: ['au'], locationRestriction: VIC, language: 'en-AU', region: 'au',
        });
        if (my === seq && document.activeElement === input) show((suggestions || []).filter((x) => x.placePrediction).slice(0, 5));
      } catch { close(); }
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    const bs = box.querySelectorAll('button');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length;
      bs.forEach((b, i) => b.classList.toggle('on', i === active));
    } else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); } else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

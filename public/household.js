// Household profile questionnaire (FW2.0). One definition used by the app (forms, progress)
// and by the API (validation). Answers are stored as { [questionId]: value }.

const o = (v, label) => ({ v, label });

export const AGE_BANDS = [
  o('0-4', '0–4'), o('5-12', '5–12'), o('13-17', '13–17'), o('18-24', '18–24'), o('25-34', '25–34'),
  o('35-44', '35–44'), o('45-54', '45–54'), o('55-64', '55–64'), o('65+', '65+'),
];
export const ADULT_BANDS = AGE_BANDS.slice(3).map((b) => b.v);
export const MEMBER_GENDERS = [o('male', 'Male'), o('female', 'Female'), o('other', 'Other'), o('na', 'Prefer not to say')];
export const MAX_MEMBERS = 12;

const ELEC_RETAILERS = ['AGL', 'Origin', 'EnergyAustralia', 'Red Energy', 'Lumo Energy', 'Alinta Energy', 'Simply Energy', 'Powershop',
  'Momentum Energy', 'Dodo', 'Tango Energy', 'GloBird Energy', 'OVO Energy', 'Amber', 'Sumo', '1st Energy', 'Energy Locals', 'ReAmped Energy', 'CovaU'];
const GAS_RETAILERS = ['AGL', 'Origin', 'EnergyAustralia', 'Red Energy', 'Lumo Energy', 'Alinta Energy', 'Simply Energy',
  'Momentum Energy', 'Dodo', 'Tango Energy', 'GloBird Energy', 'Sumo'];
const retailerOpts = (list) => [...list.map((n) => o(n, n)), o('other', 'Another company'), o('unsure', 'Not sure')];
export const FUEL_BRANDS = ['7-Eleven', 'Ampol', 'BP', 'Shell / Reddy Express', 'United', 'Mobil', 'Liberty', 'Metro', 'Costco', 'Apco'];

const HOURS = [o('0', 'None'), o('1-3', '1–3 h'), o('4-6', '4–6 h'), o('7+', '7 h or more')];

/**
 * Question types:
 *  single  — one option (value: string)
 *  multi   — several options (value: string[]); options with `only` clear the others
 *  members — [{ gender, age }], member 1 is the signed-in person
 *  address — { line, suburb, postcode }
 *  places  — [{ name, address }]
 *  vehicles— [{ name, fuel, tank, freq }]
 *  form    — a small group of fields (`fields`), value: object
 *  later   — shown but not answerable yet (arrives with a later module); not counted
 * `star`: needed to work out a result. `show(a)`: only asked when it returns true.
 */
export const SECTIONS = [
  {
    id: 'about',
    title: 'About You and Your Family',
    why: 'Tell us about your household and we’ll put the specials that suit your family first.',
    unlocked: 'Your Home specials are now sorted for your household.',
    locked: (n) => `${n} more to go and we can sort specials for your household.`,
    questions: [
      { id: 'members', type: 'members', star: true, label: 'Who lives in your home?', hint: 'Add each person. Age ranges are enough.' },
      { id: 'pets', type: 'multi', label: 'Any pets?', options: [o('none', 'No pets'), o('dog', 'Dog'), o('cat', 'Cat'), o('other', 'Other')], only: ['none'] },
      { id: 'daytime', type: 'single', star: true, label: 'On weekdays, is anyone home during the day?', options: [o('rarely', 'Rarely'), o('sometimes', 'Sometimes'), o('mostly', 'Most of the time')] },
      { id: 'address', type: 'address', star: true, label: 'Your home address', hint: 'Used to find your electricity and gas network, and as “Home” for fuel prices.' },
      { id: 'stores', type: 'multi', label: 'Where do you usually shop?', options: [o('woolworths', 'Woolworths'), o('coles', 'Coles')] },
      { id: 'favs', type: 'multi', label: 'What do you want to hear about first?', options: 'categories' },
      { id: 'diet', type: 'multi', label: 'Any food preferences?', options: [o('vegetarian', 'Vegetarian'), o('gluten_free', 'Gluten free'), o('organic', 'Organic'), o('none', 'No preference')], only: ['none'] },
      { id: 'grocery_spend', type: 'single', label: 'Roughly how much do you spend on groceries a week?', options: [o('lt100', 'Under $100'), o('100-200', '$100–200'), o('200-300', '$200–300'), o('300+', 'Over $300')] },
    ],
  },
  {
    id: 'fuel',
    title: 'Save more on Fuel',
    why: 'Tell us about your car and usual trips. We’ll work out what you really save on each fill and show prices along your routes.',
    unlocked: 'Based on how you drive, you could save about $X a month on fuel.',
    locked: (n) => `${n} more to go and we can work out your monthly fuel savings.`,
    questions: [
      { id: 'vehicles', type: 'vehicles', star: true, label: 'Your cars', hint: 'Fuel type, tank size and how often you fill up. Add as many cars as you like.' },
      { id: 'fuel_brands', type: 'multi', label: 'Brands you usually fill up at', options: [o('any', 'Any brand'), ...FUEL_BRANDS.map((b) => o(b, b))], only: ['any'] },
      { id: 'fuel_discounts', type: 'multi', label: 'Fuel discounts you use', options: [o('everyday_rewards', 'Everyday Rewards 4c'), o('flybuys', 'Flybuys 4c'), o('racv', 'RACV'), o('none', 'None')], only: ['none'] },
      { id: 'places', type: 'places', label: 'Saved places', hint: 'Home comes from your address. Add work, school or anywhere you go often, and name them.' },
      { id: 'routes', type: 'later', label: 'Saved routes', hint: 'Set up From → stops → To routes in Fuel, coming soon.' },
    ],
  },
  {
    id: 'bills',
    title: 'Save more on Bills',
    why: 'We’ll compare every electricity and gas plan in Victoria against your home and show what you could save each month.',
    unlocked: 'Switching to the best plan could save about $X a month on electricity and $X on gas.',
    locked: (n) => `${n} more to go and we can work out your savings.`,
    groups: [{ id: 'home', title: 'Your home' }, { id: 'elec', title: 'Electricity' }, { id: 'gas', title: 'Gas' }],
    questions: [
      { id: 'home_type', group: 'home', type: 'single', star: true, label: 'Type of home', options: [o('house', 'House'), o('townhouse', 'Townhouse or unit'), o('apartment', 'Apartment')] },
      { id: 'bedrooms', group: 'home', type: 'single', star: true, label: 'Bedrooms', options: [o('1', '1'), o('2', '2'), o('3', '3'), o('4', '4'), o('5+', '5 or more')] },
      { id: 'tenure', group: 'home', type: 'single', label: 'Do you own or rent?', options: [o('own', 'Own'), o('rent', 'Rent')] },

      { id: 'elec_retailer', group: 'elec', type: 'single', star: true, label: 'Your electricity company', options: retailerOpts(ELEC_RETAILERS), select: true },
      { id: 'elec_bill', group: 'elec', type: 'form', label: 'Your last electricity bill', hint: 'Makes the estimate much more accurate.', fields: [
        { id: 'amount', type: 'money', label: 'Amount ($)' }, { id: 'days', type: 'int', label: 'Days covered', min: 1, max: 400 }], unknown: 'I don’t remember' },
      { id: 'tariff', group: 'elec', type: 'single', label: 'How are you charged?', options: [o('flat', 'Same price all day'), o('tou', 'Peak and off-peak (time of use)'), o('unsure', 'Not sure')] },
      { id: 'ac_type', group: 'elec', type: 'single', star: true, label: 'Air conditioning', options: [o('ducted', 'Ducted reverse cycle'), o('split', 'Split system reverse cycle'), o('evap', 'Evaporative cooler'), o('none', 'None')] },
      { id: 'ac_units', group: 'elec', type: 'form', label: 'How many units?', show: (a) => a.ac_type && a.ac_type !== 'none', fields: [
        { id: 'indoor', type: 'int', label: 'Indoor units', min: 0, max: 20 }, { id: 'outdoor', type: 'int', label: 'Outdoor units', min: 0, max: 20 }] },
      { id: 'ac_hours', group: 'elec', type: 'form', label: 'Hours a day it runs', show: (a) => a.ac_type && a.ac_type !== 'none', fields: [
        { id: 'summer', type: 'choice', label: 'Summer', options: HOURS }, { id: 'winter', type: 'choice', label: 'Winter', options: HOURS }] },
      { id: 'hot_water', group: 'elec', type: 'single', star: true, label: 'Hot water system', options: [o('elec_storage', 'Electric storage tank'), o('elec_instant', 'Electric instant'), o('heat_pump', 'Heat pump'), o('solar', 'Solar'), o('gas', 'Gas'), o('unsure', 'Not sure')] },
      { id: 'solar', group: 'elec', type: 'form', label: 'Solar panels', fields: [
        { id: 'has', type: 'choice', label: 'Do you have solar?', options: [o('no', 'No'), o('yes', 'Yes')] },
        { id: 'kw', type: 'number', label: 'Size (kW), if you know it', min: 0, max: 100, show: (v) => v.has === 'yes' }] },
      { id: 'battery', group: 'elec', type: 'form', label: 'Home battery', fields: [
        { id: 'has', type: 'choice', label: 'Do you have a battery?', options: [o('no', 'No'), o('yes', 'Yes')] },
        { id: 'kwh', type: 'number', label: 'Size (kWh), if you know it', min: 0, max: 200, show: (v) => v.has === 'yes' }] },
      { id: 'ev', group: 'elec', type: 'form', label: 'Electric or plug-in hybrid car', fields: [
        { id: 'has', type: 'choice', label: 'Do you charge one at home?', options: [o('no', 'No'), o('yes', 'Yes')] },
        { id: 'count', type: 'int', label: 'How many', min: 1, max: 6, show: (v) => v.has === 'yes' },
        { id: 'km', type: 'int', label: 'Km driven a week (all of them)', min: 0, max: 5000, show: (v) => v.has === 'yes' },
        { id: 'when', type: 'choice', label: 'Usually charged', options: [o('night', 'Overnight'), o('day', 'During the day'), o('evening', 'Early evening')], show: (v) => v.has === 'yes' }] },
      { id: 'pool', group: 'elec', type: 'form', label: 'Pool', fields: [
        { id: 'has', type: 'choice', label: 'Do you have a pool?', options: [o('no', 'No'), o('yes', 'Yes')] },
        { id: 'summer', type: 'choice', label: 'Pump hours a day in summer', options: HOURS, show: (v) => v.has === 'yes' },
        { id: 'winter', type: 'choice', label: 'Pump hours a day in winter', options: HOURS, show: (v) => v.has === 'yes' },
        { id: 'heated', type: 'choice', label: 'Electric pool heating?', options: [o('no', 'No'), o('yes', 'Yes')], show: (v) => v.has === 'yes' }] },
      { id: 'appliances', group: 'elec', type: 'multi', label: 'Big appliances you use (pick any)', options: [o('oven', 'Electric oven or cooktop'), o('induction', 'Induction cooktop'),
        o('dryer', 'Clothes dryer'), o('dishwasher', 'Dishwasher'), o('fridge2', 'Second fridge or freezer'), o('heater', 'Electric heaters'),
        o('floor', 'Underfloor heating'), o('blanket', 'Electric blankets'), o('none', 'None of these')], only: ['none'] },
      { id: 'home_office', group: 'elec', type: 'form', label: 'Home office', fields: [
        { id: 'has', type: 'choice', label: 'Does anyone work from home?', options: [o('no', 'No'), o('yes', 'Yes')] },
        { id: 'people', type: 'choice', label: 'How many people', options: [o('1', '1'), o('2', '2'), o('3+', '3 or more')], show: (v) => v.has === 'yes' },
        { id: 'days', type: 'choice', label: 'Days a week each', options: [o('1', '1'), o('2', '2'), o('3', '3'), o('4', '4'), o('5', '5')], show: (v) => v.has === 'yes' }] },
      { id: 'concession', group: 'elec', type: 'single', label: 'Concession card', options: [o('pension', 'Pensioner Concession Card'), o('hcc', 'Health Care Card'), o('none', 'None')] },
      { id: 'meter_upload', group: 'elec', type: 'later', label: 'Upload your smart meter data', hint: 'Coming with Bills: the most accurate estimate, from your real usage.' },

      { id: 'has_gas', group: 'gas', type: 'single', star: true, label: 'Is your home connected to mains gas?', options: [o('yes', 'Yes'), o('no', 'No'), o('unsure', 'Not sure')] },
      { id: 'gas_retailer', group: 'gas', type: 'single', star: true, label: 'Your gas company', options: retailerOpts(GAS_RETAILERS), select: true, show: (a) => a.has_gas === 'yes' },
      { id: 'gas_bill', group: 'gas', type: 'form', label: 'Your last gas bill', show: (a) => a.has_gas === 'yes', fields: [
        { id: 'amount', type: 'money', label: 'Amount ($)' }, { id: 'days', type: 'int', label: 'Days covered', min: 1, max: 400 }], unknown: 'I don’t remember' },
      { id: 'gas_heating', group: 'gas', type: 'single', star: true, label: 'Gas heating', show: (a) => a.has_gas === 'yes', options: [o('ducted', 'Ducted gas heating'), o('space', 'Gas wall or space heater'), o('no', 'No gas heating')] },
      { id: 'heating_use', group: 'gas', type: 'form', label: 'How much do you use the heating?', show: (a) => a.has_gas === 'yes' && a.gas_heating && a.gas_heating !== 'no', fields: [
        { id: 'months', type: 'choice', label: 'Months a year', options: [o('0-2', '0–2'), o('3-4', '3–4'), o('5+', '5 or more')] },
        { id: 'hours', type: 'choice', label: 'Hours a day', options: [o('1-3', '1–3 h'), o('4-6', '4–6 h'), o('7+', '7 h or more')] }] },
      { id: 'gas_hot_water', group: 'gas', type: 'single', star: true, label: 'Gas hot water', show: (a) => a.has_gas === 'yes', options: [o('instant', 'Gas instant'), o('storage', 'Gas storage tank'), o('no', 'Not gas')] },
      { id: 'cooktop', group: 'gas', type: 'single', label: 'Cooktop', show: (a) => a.has_gas === 'yes', options: [o('gas', 'Gas'), o('electric', 'Electric or induction')] },
      { id: 'cooking', group: 'gas', type: 'single', label: 'Home-cooked meals a week', show: (a) => a.has_gas === 'yes' && a.cooktop === 'gas', options: [o('0-5', '0–5'), o('6-10', '6–10'), o('11-15', '11–15'), o('16+', '16 or more')] },
    ],
  },
];

// Fuel: the questions each car carries.
export const VEHICLE_FIELDS = [
  { id: 'name', type: 'text', label: 'Name', placeholder: 'Family car', max: 30 },
  { id: 'fuel', type: 'choice', label: 'Fuel', star: true, options: [o('u91', 'ULP 91'), o('e10', 'E10'), o('p95', 'Premium 95'), o('p98', 'Premium 98'), o('diesel', 'Diesel'), o('lpg', 'LPG'), o('ev', 'Electric')] },
  { id: 'tank', type: 'choice', label: 'Tank size', star: true, options: [o('45', 'Small car ~45 L'), o('55', 'Mid-size ~55 L'), o('65', 'SUV ~65 L'), o('80', 'Large or ute ~80 L')], show: (v) => v.fuel !== 'ev' },
  { id: 'freq', type: 'choice', label: 'How often you fill up', star: true, options: [o('2w', 'Twice a week or more'), o('1w', 'Once a week'), o('2wk', 'Every 2 weeks'), o('1m', 'Once a month or less')], show: (v) => v.fuel !== 'ev' },
];

export const sectionById = (id) => SECTIONS.find((s) => s.id === id);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Is a question answered? (Shown questions only.) */
export function answered(q, a) {
  const v = a[q.id];
  if (q.type === 'later') return false;
  if (q.type === 'members') return Array.isArray(v) && v.length > 0 && v.every((m) => m.gender && m.age);
  if (q.type === 'vehicles') return Array.isArray(v) && v.some((c) => c.fuel && (c.fuel === 'ev' || (c.tank && c.freq)));
  if (q.type === 'places') return Array.isArray(v) && v.length > 0;
  if (q.type === 'multi') return Array.isArray(v) && v.length > 0;
  if (q.type === 'address') return isObj(v) && !!v.line && /^3\d{3}$|^8\d{3}$/.test(v.postcode || '');
  if (q.type === 'form') {
    if (!isObj(v)) return false;
    if (q.unknown && v.unknown) return true;
    return q.fields.every((f) => (f.show && !f.show(v)) || (v[f.id] !== undefined && v[f.id] !== ''));
  }
  return v !== undefined && v !== null && v !== '';
}

/** Progress for one section: { done, total, starsLeft, complete } over the questions currently shown. */
export function progress(section, a) {
  const shown = section.questions.filter((q) => q.type !== 'later' && (!q.show || q.show(a)));
  const done = shown.filter((q) => answered(q, a)).length;
  const starsLeft = shown.filter((q) => q.star && !answered(q, a)).length;
  return { done, total: shown.length, starsLeft, unlocked: starsLeft === 0 };
}

// ---------- validation (API) ----------
const optVals = (opts) => opts.map((x) => x.v);
function cleanField(f, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (f.type === 'choice') return optVals(f.options).includes(String(raw)) ? String(raw) : undefined;
  if (f.type === 'text') return String(raw).trim().slice(0, f.max || 60) || undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  if (f.type === 'money') return n >= 0 && n <= 100000 ? Math.round(n * 100) / 100 : undefined;
  if (f.type === 'int') return Number.isInteger(n) && n >= (f.min ?? 0) && n <= (f.max ?? 1e6) ? n : undefined;
  return n >= (f.min ?? 0) && n <= (f.max ?? 1e6) ? Math.round(n * 10) / 10 : undefined;
}
function cleanObj(fields, raw) {
  if (!isObj(raw)) return undefined;
  const out = {};
  for (const f of fields) {
    if (f.show && !f.show(out)) continue;
    const v = cleanField(f, raw[f.id]);
    if (v !== undefined) out[f.id] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * Keeps only valid answers for one section. `categories` = the allowed favourite categories.
 * Returns a clean answers object (unknown keys and bad values dropped).
 */
export function cleanSection(sectionId, input, categories = []) {
  const s = sectionById(sectionId);
  if (!s || !isObj(input)) return {};
  const out = {};
  for (const q of s.questions) {
    const raw = input[q.id];
    if (raw === undefined || raw === null) continue;
    let v;
    if (q.type === 'single') v = optVals(q.options).includes(String(raw)) ? String(raw) : undefined;
    else if (q.type === 'multi') {
      const allowed = q.options === 'categories' ? categories : optVals(q.options);
      let arr = (Array.isArray(raw) ? raw : []).map(String).filter((x, i, a) => allowed.includes(x) && a.indexOf(x) === i);
      const solo = arr.find((x) => (q.only || []).includes(x));
      if (solo) arr = [solo];
      v = arr.length ? arr : undefined;
    } else if (q.type === 'members') {
      v = (Array.isArray(raw) ? raw : []).slice(0, MAX_MEMBERS).map((m, i) => ({
        gender: optVals(MEMBER_GENDERS).includes(m?.gender) ? m.gender : '',
        age: (i === 0 ? ADULT_BANDS : optVals(AGE_BANDS)).includes(m?.age) ? m.age : '',
      }));
      v = v.length ? v : undefined;
    } else if (q.type === 'address') {
      const pc = str(raw.postcode, 4);
      const a = { line: str(raw.line, 120), suburb: str(raw.suburb, 40), postcode: /^\d{4}$/.test(pc) ? pc : '' };
      v = a.line || a.postcode ? a : undefined;
    } else if (q.type === 'places') {
      v = (Array.isArray(raw) ? raw : []).slice(0, 20).map((p) => ({ name: str(p?.name, 30), address: str(p?.address, 120) })).filter((p) => p.name && p.address);
      v = v.length ? v : undefined;
    } else if (q.type === 'vehicles') {
      v = (Array.isArray(raw) ? raw : []).slice(0, 6).map((c) => cleanObj(VEHICLE_FIELDS, c)).filter(Boolean);
      v = v.length ? v : undefined;
    } else if (q.type === 'form') {
      v = q.unknown && raw?.unknown === true ? { unknown: true } : cleanObj(q.fields, raw);
    }
    if (v !== undefined) out[q.id] = v;
  }
  // Hot water: choosing gas in the electricity part fills in the gas part's default.
  if (sectionId === 'bills' && out.hot_water === 'gas' && !out.gas_hot_water && out.has_gas === 'yes') out.gas_hot_water = 'instant';
  return out;
}

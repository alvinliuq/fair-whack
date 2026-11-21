// Sanity check: price a few sample households against the live plan data and print the results.
import { makeDb } from './d1.js';
import { compare } from '../shared/energy.js';
const db = await makeDb();
const homes = {
  'Bentleigh East 3165, 4 people, split AC, gas heating': { pc: '3165', a: { members: [{}, {}, {}, {}], daytime: 'sometimes', home_type: 'house', bedrooms: '4', ac_type: 'split', ac_units: { indoor: 3 }, ac_hours: { summer: '4-6', winter: '1-3' }, hot_water: 'gas', has_gas: 'yes', gas_heating: 'ducted', heating_use: { months: '3-4', hours: '4-6' }, gas_hot_water: 'instant', cooktop: 'gas', cooking: '11-15' } },
  'Geelong 3220, 2 people, solar 6.6 kW, all electric': { pc: '3220', a: { members: [{}, {}], daytime: 'mostly', home_type: 'house', bedrooms: '3', ac_type: 'ducted', hot_water: 'heat_pump', solar: { has: 'yes', kw: 6.6 }, has_gas: 'no' } },
  'Melbourne 3000 apartment, 1 person': { pc: '3000', a: { members: [{}], daytime: 'rarely', home_type: 'apartment', bedrooms: '1', ac_type: 'split', ac_units: { indoor: 1 }, hot_water: 'elec_storage', has_gas: 'no' } },
};
for (const [label, h] of Object.entries(homes)) {
  for (const fuel of ['E', 'G']) {
    if (fuel === 'G' && h.a.has_gas !== 'yes') continue;
    const rows = await db.all('SELECT networks, model FROM energy_plan WHERE fuel = ? AND postcodes LIKE ?', [fuel, `%,${h.pc},%`]);
    const nets = {};
    for (const r of rows) nets[r.networks] = (nets[r.networks] || 0) + 1;
    const top = Object.entries(nets).sort((x, y) => y[1] - x[1])[0]?.[0];
    const r = compare(fuel, rows.filter((x) => x.networks === top).map((x) => JSON.parse(x.model)), h.a, null);
    console.log(`\n${label} — ${fuel === 'E' ? 'electricity' : 'gas'}: ${rows.length} plans at postcode, networks ${JSON.stringify(nets)}`);
    console.log(`  usage ${r.usage?.units} ${r.usage?.unit}, solar ${r.usage?.solarKwh}; compared ${r.count}; current (${r.current?.basis}) $${r.current?.total}/yr`);
    for (const b of r.best || []) console.log(`  $${b.year}/yr  ${b.brandName} — ${b.name} [${b.tariff}${b.cl ? ', CL' : ''}] fit $${b.fit} disc $${b.condDisc}`);
  }
}

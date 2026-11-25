// Retailers shown in the app (stage 6). One place for names and kind; shared by the app, API and pipeline.
// kind: 'supermarket' (weekly specials on Wednesdays) or 'general'.
// fallbackCategory: the merged category used when nothing in the product's own category or name decides it.
export const RETAILER_INFO = {
  woolworths:       { name: 'Woolworths',        kind: 'supermarket' },
  coles:            { name: 'Coles',             kind: 'supermarket' },
  aldi:             { name: 'ALDI',              kind: 'supermarket' },
  costco:           { name: 'Costco',            kind: 'general' },
  jbhifi:           { name: 'JB Hi-Fi',          kind: 'general', fallbackCategory: 'Electronics' },
  bunnings:         { name: 'Bunnings',          kind: 'general', fallbackCategory: 'Home & Hardware' },
  kmart:            { name: 'Kmart',             kind: 'general', fallbackCategory: 'Home & Hardware' },
  bigw:             { name: 'BIG W',             kind: 'general' },
  officeworks:      { name: 'Officeworks',       kind: 'general', fallbackCategory: 'Office & School' },
  chemistwarehouse: { name: 'Chemist Warehouse', kind: 'general', fallbackCategory: 'Health & Beauty' },
  // Second batch (Zyte)
  target:           { name: 'Target',            kind: 'general', fallbackCategory: 'Home & Hardware' },
  thegoodguys:      { name: 'The Good Guys',     kind: 'general', fallbackCategory: 'Electronics' },
  petbarn:          { name: 'Petbarn',           kind: 'general', fallbackCategory: 'Pet' },
  peto:             { name: 'PetO',              kind: 'general', fallbackCategory: 'Pet' },
  decathlon:        { name: 'Decathlon',         kind: 'general', fallbackCategory: 'Sports & Outdoors' },
  ebgames:          { name: 'EB Games',          kind: 'general', fallbackCategory: 'Electronics' },
};

export const RETAILER_IDS = Object.keys(RETAILER_INFO);
export const retailerName = (r) => RETAILER_INFO[r]?.name || r;

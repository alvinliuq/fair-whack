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
};

export const RETAILER_IDS = Object.keys(RETAILER_INFO);
export const retailerName = (r) => RETAILER_INFO[r]?.name || r;

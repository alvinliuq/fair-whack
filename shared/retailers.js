// Retailers shown in the app (stage 6). One place for names and kind; shared by the app, API and pipeline.
// kind: 'supermarket' (weekly specials on Wednesdays) or 'general'.
// fallbackCategory: the merged category used when nothing in the product's own category or name decides it.
// Order = order of store buttons in the app. Colours alternate warm/cool so similar colours never sit side by side
// (stage 7); a colour only repeats with several stores between.
export const RETAILER_INFO = {
  woolworths:       { name: 'Woolworths',        kind: 'supermarket', color: '#178841' },
  coles:            { name: 'Coles',             kind: 'supermarket', color: '#E01A22' },
  aldi:             { name: 'ALDI',              kind: 'supermarket', color: '#00205B' },
  jbhifi:           { name: 'JB Hi-Fi',          kind: 'general', fallbackCategory: 'Electronics', color: '#E8B800' },
  costco:           { name: 'Costco',            kind: 'general', color: '#005DAA' },
  kmart:            { name: 'Kmart',             kind: 'general', fallbackCategory: 'Home & Hardware', color: '#E4002B' },
  bunnings:         { name: 'Bunnings',          kind: 'general', fallbackCategory: 'Home & Hardware', color: '#0D6B3C' },
  petbarn:          { name: 'Petbarn',           kind: 'general', fallbackCategory: 'Pet', color: '#F37021' },
  bigw:             { name: 'BIG W',             kind: 'general', color: '#0046BE' },
  chemistwarehouse: { name: 'Chemist Warehouse', kind: 'general', fallbackCategory: 'Health & Beauty', color: '#E6007E' },
  thegoodguys:      { name: 'The Good Guys',     kind: 'general', fallbackCategory: 'Electronics', color: '#2B2B2B' },
  target:           { name: 'Target',            kind: 'general', fallbackCategory: 'Home & Hardware', color: '#CC0000' },
  officeworks:      { name: 'Officeworks',       kind: 'general', fallbackCategory: 'Office & School', color: '#0072CE' },
  ebgames:          { name: 'EB Games',          kind: 'general', fallbackCategory: 'Electronics', color: '#7B2FBE' },
  peto:             { name: 'PetO',              kind: 'general', fallbackCategory: 'Pet', color: '#00A3AD' },
  decathlon:        { name: 'Decathlon',         kind: 'general', fallbackCategory: 'Sports & Outdoors', color: '#0082C3' },
  // Third batch (27 Nov), read through Zyte.
  harveynorman:     { name: 'Harvey Norman',     kind: 'general', fallbackCategory: 'Electronics', color: '#C8102E' },
  petstock:         { name: 'PETstock',          kind: 'general', fallbackCategory: 'Pet', color: '#00843D' },
  petcircle:        { name: 'Pet Circle',        kind: 'general', fallbackCategory: 'Pet', color: '#1B75BB' },
};

export const RETAILER_IDS = Object.keys(RETAILER_INFO);
export const retailerName = (r) => RETAILER_INFO[r]?.name || r;

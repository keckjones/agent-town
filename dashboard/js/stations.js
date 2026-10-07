// The stations on the trading floor. Keys 1–9 and 0 jump straight to each one.
export const STATIONS = [
  { id: 'overview',   key: '1', name: 'Executive Overview',        short: 'Executive',  accent: '#f2c14e', division: 'hq' },
  { id: 'approvals',  key: '2', name: 'Approvals & Alerts',        short: 'Approvals',  accent: '#f2c14e', division: null },
  { id: 'agency',     key: '3', name: 'Local Website Agency',      short: 'Agency',     accent: '#3aa0ff', division: 'agency' },
  { id: 'sports',     key: '4', name: 'Sports Platform Marketing', short: 'Sports',     accent: '#ff4f6d', division: 'sports' },
  { id: 'etsy',       key: '5', name: 'Etsy Commerce',             short: 'Etsy',       accent: '#f08a4b', division: 'etsy' },
  { id: 'dropship',   key: '6', name: 'Dropshipping Commerce',     short: 'Dropship',   accent: '#2fd38a', division: 'dropship' },
  { id: 'realestate', key: '7', name: 'Real Estate Wholesaling',   short: 'Real Estate',accent: '#c79bff', division: 'realestate' },
  { id: 'ventures',   key: '8', name: 'Research & New Ventures',   short: 'Ventures',   accent: '#5fd0e6', division: 'ventures' },
  { id: 'customers',  key: '9', name: 'Customer Operations',       short: 'Customers',  accent: '#7db7ff', division: 'customers' },
  { id: 'finance',    key: '0', name: 'Finance & Performance',     short: 'Finance',    accent: '#2fd38a', division: 'finance' },
  { id: 'setup',      key: 's', name: 'Connections & Settings',    short: 'Setup',      accent: '#8592a5', division: null, offFloor: true },
];
export const byId = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

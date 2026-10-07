// Stations in the left rail. Keys 1–9/0 jump to each; letters open views (see app.js shortcuts).
export const STATIONS = [
  { id: 'overview',   key: '1', name: 'Executive Office',          short: 'Executive',  accent: '#f2c14e', division: 'hq', dept: 'exec' },
  { id: 'approvals',  key: '2', name: 'Approvals & Alerts',        short: 'Approvals',  accent: '#f2c14e', division: null },
  { id: 'monitor',    key: 'g', name: 'All Agents',                short: 'Agents',     accent: '#f2c14e', division: null },
  { id: 'team',       key: 'j', name: 'Projects & Requests',       short: 'Projects',   accent: '#f2c14e', division: null },
  { id: 'links',      key: 'l', name: 'Live Links & Analytics',    short: 'Live Links', accent: '#7be0a8', division: null },
  { id: 'timeline',   key: 't', name: "Today's Timeline",          short: 'Timeline',   accent: '#5fd0e6', division: null },
  { id: 'agency',     key: '3', name: 'Local Website Agency',      short: 'Agency',     accent: '#3aa0ff', division: 'agency', dept: 'agency' },
  { id: 'sports',     key: '4', name: 'Sports Platform Marketing', short: 'Sports',     accent: '#ff4f6d', division: 'sports', dept: 'sports' },
  { id: 'etsy',       key: '5', name: 'Etsy Commerce',             short: 'Etsy',       accent: '#f08a4b', division: 'etsy', dept: 'etsy' },
  { id: 'dropship',   key: '6', name: 'Dropshipping Commerce',     short: 'Dropship',   accent: '#2fd38a', division: 'dropship', dept: 'dropship' },
  { id: 'realestate', key: '7', name: 'Real Estate Wholesaling',   short: 'Real Estate',accent: '#c79bff', division: 'realestate', dept: 'realestate' },
  { id: 'media',      key: 'v', name: 'Brands, Social & Video',    short: 'Content',    accent: '#ff8bd1', division: 'media', dept: 'media' },
  { id: 'ventures',   key: '8', name: 'Research & New Ventures',   short: 'Ventures',   accent: '#5fd0e6', division: 'ventures', dept: 'ventures' },
  { id: 'customers',  key: '9', name: 'Customer Operations',       short: 'Customers',  accent: '#7db7ff', division: 'customers', dept: 'customers' },
  { id: 'finance',    key: '0', name: 'Finance & Performance',     short: 'Finance',    accent: '#7be0a8', division: 'finance', dept: 'finance' },
  { id: 'hq',         key: null, name: 'Risk & Workflow Improvement', short: 'Risk & Ops', accent: '#d9a441', division: 'hq', dept: 'hq' },
  { id: 'setup',      key: 's', name: 'Connections & Settings',    short: 'Setup',      accent: '#8592a5', division: null },
];
export const byId = Object.fromEntries(STATIONS.map((s) => [s.id, s]));
export const stationForDept = (dept) => STATIONS.find((s) => s.dept === dept)?.id || 'overview';

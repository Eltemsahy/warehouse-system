export const inventoryMetrics = [
  {
    label: 'Total inventory',
    value: '12,840',
    unit: '',
    note: 'Across 6 locations',
    tone: 'orange',
    icon: '▤',
  },
  {
    label: 'Inbound today',
    value: '248',
    unit: 'units',
    note: 'Receiving in progress',
    tone: 'green',
    icon: '↙',
  },
  {
    label: 'Ready to ship',
    value: '36',
    unit: 'orders',
    note: '12 need picking',
    tone: 'blue',
    icon: '↗',
  },
] as const

export const recentMovements = [
  {
    title: 'Stock received',
    location: 'SKU-2048 · Zone A-03',
    quantity: '+48',
    time: '09:42',
    direction: 'in',
    icon: '↓',
  },
  {
    title: 'Order picked',
    location: 'SKU-1182 · Zone B-01',
    quantity: '−12',
    time: '09:18',
    direction: 'out',
    icon: '↑',
  },
  {
    title: 'Stock relocated',
    location: 'SKU-3091 · Zone C-02',
    quantity: '+24',
    time: '08:56',
    direction: 'move',
    icon: '↗',
  },
] as const

export const warehouseLocations = [
  { name: 'A1', occupancy: '84%', level: 'high' },
  { name: 'A2', occupancy: '62%', level: 'low' },
  { name: 'B1', occupancy: '76%', level: 'medium' },
  { name: 'B2', occupancy: '48%', level: 'empty' },
  { name: 'C1', occupancy: '55%', level: 'low' },
  { name: 'C2', occupancy: '91%', level: 'high' },
] as const

export const workflowSteps = [
  {
    number: '01',
    label: 'RECEIVE',
    icon: '↓',
    tone: 'green',
    title: 'Know what’s coming in.',
    description:
      'Record receipts and add stock with a clear trail from the first scan to its storage location.',
    link: 'Explore receiving',
    href: '#workflow',
  },
  {
    number: '02',
    label: 'ORGANIZE',
    icon: '⌘',
    tone: 'orange',
    title: 'Put every item in place.',
    description:
      'Keep products, locations, and stock levels in step as inventory moves around your warehouse.',
    link: 'Explore inventory',
    href: '#workflow',
  },
  {
    number: '03',
    label: 'FULFILL',
    icon: '↗',
    tone: 'blue',
    title: 'Keep orders moving out.',
    description:
      'Connect the next pick or stock transfer to an inventory ledger designed to track every change.',
    link: 'Explore fulfillment',
    href: '#workflow',
  },
] as const

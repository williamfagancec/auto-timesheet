// Check current times and what should be synced

const now = new Date()
const timezone = 'Australia/Sydney'

console.log('=== Current Time Analysis ===')
console.log('Current UTC time:', now.toISOString())

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

const parts = formatter.formatToParts(now)
const getValue = (type: string) => parts.find(p => p.type === type)?.value || '0'

const localTimeStr = `${getValue('year')}-${getValue('month')}-${getValue('day')}T${getValue('hour')}:${getValue('minute')}:${getValue('second')}`
console.log('Sydney local time:', localTimeStr)

console.log('\n=== Thursday Events Analysis ===')
console.log('Thursday in UTC: 2025-11-06T00:00:00Z to 2025-11-07T00:00:00Z')
console.log('Thursday in Sydney: 2025-11-06T11:00:00+11:00 (= 2025-11-06T00:00:00Z)')
console.log('                    to 2025-11-07T11:00:00+11:00 (= 2025-11-07T00:00:00Z)')

console.log('\n=== What Should Sync ===')
console.log('If current Sydney time is Thursday 10:34 AM:')
console.log('  - UTC time would be: Wednesday 11:34 PM (2025-11-06T23:34:00Z)')
console.log('  - Events that have ENDED before 23:34 UTC on 2025-11-06')
console.log('  - This means events ending at:')
console.log('    - 01:00 UTC (12:00 PM Sydney) ✅')
console.log('    - 01:30 UTC (12:30 PM Sydney) ✅')
console.log('    - 02:00 UTC (1:00 PM Sydney)  ✅')
console.log('    - etc.')
console.log('  - Events STARTING at 22:45 UTC (9:45 AM Friday Sydney) ❌ Still in future')

// List the 8 events from database
const events = [
  { title: 'journey map', end: '2025-11-06T01:00:00.000Z' },
  { title: 'lunch', end: '2025-11-06T01:30:00.000Z' },
  { title: 'decide on API product - ASIC', end: '2025-11-06T02:00:00.000Z' },
  { title: 'Internal Standup - Club 4X4 Portal', end: '2025-11-06T04:15:00.000Z' },
  { title: 'UAT testing prep', end: '2025-11-06T05:00:00.000Z' },
  { title: 'Daily Resourcing Stand Up', end: '2025-11-06T23:00:00.000Z' },
  { title: 'PSC TCR Daily Standup', end: '2025-11-06T23:15:00.000Z' },
  { title: 'quick benefits chat - TCR', end: '2025-11-06T23:45:00.000Z' },
]

console.log('\n=== Events in Database ===')
events.forEach((event, i) => {
  const endTime = new Date(event.end)
  const sydneyEndTime = endTime.toLocaleString('en-US', { timeZone: 'Australia/Sydney', hour12: false })
  const isPast = endTime < now
  console.log(`${i + 1}. ${event.title}`)
  console.log(`   End UTC: ${event.end} (${sydneyEndTime} Sydney)`)
  console.log(`   Has ended? ${isPast ? '✅ YES' : '❌ NO (future)'}`)
})

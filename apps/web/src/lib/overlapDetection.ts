interface CalendarEvent {
  id: string
  startTime: Date
  endTime: Date
}

/**
 * Detect overlapping events
 * Returns a Map of event IDs that have overlaps with other events
 */
export function detectOverlappingEvents(events: CalendarEvent[]): Map<string, boolean> {
  const overlaps = new Map<string, boolean>()

  // Compare each event with every other event
  for (let i = 0; i < events.length; i++) {
    const event1 = events[i]

    for (let j = i + 1; j < events.length; j++) {
      const event2 = events[j]

      // Check if events overlap
      const event1Start = event1.startTime.getTime()
      const event1End = event1.endTime.getTime()
      const event2Start = event2.startTime.getTime()
      const event2End = event2.endTime.getTime()

      // Events overlap if:
      // - event1 starts before event2 ends AND
      // - event2 starts before event1 ends
      if (event1Start < event2End && event2Start < event1End) {
        overlaps.set(event1.id, true)
        overlaps.set(event2.id, true)
      }
    }
  }

  return overlaps
}

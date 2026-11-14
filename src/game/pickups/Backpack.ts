export type BackpackItem = {
  readonly id: string
  readonly label: string
}

type Listener = (items: readonly BackpackItem[]) => void

/**
 * The player's inventory.
 *
 * `capacity` is null for no limit (the current setting), or a number to cap
 * how many items fit.
 */
export class Backpack {
  private readonly contents: BackpackItem[] = []
  private readonly listeners = new Set<Listener>()

  constructor(readonly capacity: number | null = null) {}

  get items(): readonly BackpackItem[] {
    return this.contents
  }

  get isFull(): boolean {
    return this.capacity !== null && this.contents.length >= this.capacity
  }

  /** Adds an item. Returns false if the backpack is full. */
  add(item: BackpackItem): boolean {
    if (this.isFull) return false
    this.contents.push(item)
    this.emit()
    return true
  }

  has(id: string): boolean {
    return this.contents.some((item) => item.id === id)
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.contents)
  }
}

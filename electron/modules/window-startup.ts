/** The minimum starts only once the splash has painted in a visible window. */
export class WindowStartup {
  private visible = false
  private painted = false
  private started = false
  private elapsed = false
  private prepared = false
  private disposed = false
  private timer?: ReturnType<typeof setTimeout>
  private resolve!: (ready: boolean) => void
  readonly ready = new Promise<boolean>(resolve => { this.resolve = resolve })

  constructor(private readonly minimumMs = 1000) {}

  shown(): void { this.visible = true; this.start() }
  splashPainted(): void { this.painted = true; this.start() }
  rendererReady(): Promise<boolean> { this.prepared = true; this.release(); return this.ready }

  private start(): void {
    if (this.disposed || this.started || !this.visible || !this.painted) return
    this.started = true
    this.timer = setTimeout(() => { this.elapsed = true; this.release() }, this.minimumMs)
  }

  private release(): void {
    if (!this.disposed && this.elapsed && this.prepared) this.resolve(true)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.resolve(false)
  }
}

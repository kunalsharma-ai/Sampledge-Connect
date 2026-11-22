import { Injectable } from '@nestjs/common';

/** Lets the inbox wake the outbound worker right after a reply is queued, without a module cycle. */
@Injectable()
export class OutboxSignal {
  private listener: (() => void) | null = null;
  onPoke(fn: () => void) {
    this.listener = fn;
  }
  poke() {
    this.listener?.();
  }
}

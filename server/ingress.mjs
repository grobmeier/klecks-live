export class IngressBudget {
  constructor(rate, capacity) { this.rate = rate; this.capacity = capacity; this.tokens = capacity; this.updatedAt = performance.now(); }
  take(amount) {
    const now = performance.now();
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.updatedAt) * this.rate / 1000);
    this.updatedAt = now;
    if (amount > this.tokens) return false;
    this.tokens -= amount; return true;
  }
}

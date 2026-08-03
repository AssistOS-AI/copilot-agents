import { Buffer } from 'node:buffer';

export class BoundedByteTail {
    #limit;
    #tail;
    #totalBytes;

    constructor(limit) {
        if (!Number.isSafeInteger(limit) || limit <= 0) {
            throw new TypeError('bounded tail limit must be a positive safe integer');
        }
        this.#limit = limit;
        this.#tail = Buffer.alloc(0);
        this.#totalBytes = 0;
    }

    push(chunk) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.#totalBytes += bytes.length;
        if (bytes.length >= this.#limit) {
            this.#tail = Buffer.from(bytes.subarray(bytes.length - this.#limit));
            return;
        }
        const combined = Buffer.concat([this.#tail, bytes]);
        this.#tail = combined.length > this.#limit
            ? Buffer.from(combined.subarray(combined.length - this.#limit))
            : combined;
    }

    snapshot() {
        const retainedBytes = this.#tail.length;
        const discardedBytes = this.#totalBytes - retainedBytes;
        return Object.freeze({
            text: this.#tail.toString('utf8'),
            byteLength: this.#totalBytes,
            retainedBytes,
            discardedBytes,
            truncated: discardedBytes > 0,
        });
    }
}

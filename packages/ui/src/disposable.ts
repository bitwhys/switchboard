// The teardown handle every ui factory returns. Structurally identical to
// the kernel's Disposable (kernel spec §4.3) without importing it — this
// package is dependency-free by design.

export interface Disposable {
	dispose(): void;
}

import '@testing-library/jest-dom/vitest';

// jsdom implements neither, and both are reached during an ordinary designer render: the
// canvas measures itself to scale the page, and the inspector scrolls a freshly selected
// section into view. Without these the failure surfaces as an unhandled React commit error
// several frames away from the cause.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

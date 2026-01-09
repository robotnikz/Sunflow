
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock ResizeObserver (required by Recharts)
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock global fetch if needed by components directly, 
// though we usually mock the api service layer in tests.
global.fetch =  vi.fn();

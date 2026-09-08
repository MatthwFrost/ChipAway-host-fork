import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals`, so React Testing Library cannot install its own
// auto-cleanup. Without this, renders stack up in the same document and the
// duplicate element ids make id-scoped queries resolve against the wrong tree.
afterEach(cleanup);

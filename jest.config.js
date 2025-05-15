/**
 * Jest configuration file
 */
module.exports = {
  // The root directory for the Jest configuration
  rootDir: '.',
  
  // Test environment
  testEnvironment: 'node',
  
  // The glob patterns Jest uses to detect test files
  testMatch: [
    '**/__tests__/**/*.js',
    '**/tests/**/*.test.js',
  ],
  
  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.js',
    '!**/node_modules/**',
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  
  // Additional setup
  setupFilesAfterEnv: [],
  
  // Watch options
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname',
  ],
};